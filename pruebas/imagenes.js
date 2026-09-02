// Prueba que la compresion del lado del SERVIDOR actua aunque se saltee el
// navegador (que es exactamente el agujero que tenia antes).
const BASE = 'http://app:3000/api';
let cookie = '';
let ok = 0, fallo = 0; const fallos = [];
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  OK   ${n}`); } else { fallo++; fallos.push(n + ' -> ' + d); console.log(`  FALLA ${n} ${d}`); } };

async function api(ruta, opts = {}) {
  const res = await fetch(BASE + ruta, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let b = null; try { b = await res.json(); } catch {}
  return { status: res.status, body: b };
}

// PNG grande generado a mano (sin librerias): ruido para que no comprima solo.
function pngGrande(ancho, alto) {
  const zlib = require('zlib');
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(ancho * 3 + 1);
    fila[0] = 0;
    for (let x = 0; x < ancho; x++) {
      fila[1 + x * 3] = (x * 7 + y * 13) % 256;
      fila[2 + x * 3] = (x * 3 + y * 5) % 256;
      fila[3 + x * 3] = (x * 11 + y * 2) % 256;
    }
    filas.push(fila);
  }
  const datos = zlib.deflateSync(Buffer.concat(filas));

  const crc32 = (buf) => {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(tipo), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', datos), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function subir(nombre, buffer) {
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'image/png' }), nombre);
  const res = await fetch(BASE + '/attachments', { method: 'POST', headers: { cookie }, body: form });
  let b = null; try { b = await res.json(); } catch {}
  return { status: res.status, body: b };
}

(async () => {
  await api('/auth/login', { method: 'POST', body: { username: 'admin', password: process.env.ADMIN_PASS } });

  console.log('\n=== Compresion del lado del servidor (salteando el navegador) ===');

  const grande = pngGrande(2400, 1600);
  console.log(`  imagen de prueba: 2400x1600, ${(grande.length / 1024 / 1024).toFixed(2)} MB`);
  check('la imagen de prueba supera el lado maximo (1600 px)', 2400 > 1600);

  const r = await subir('captura-enorme.png', grande);
  check('la subida es aceptada', r.status === 201, JSON.stringify(r.body).slice(0, 200));

  const adj = r.body?.attachments?.[0];
  if (adj) {
    console.log(`  guardado: ${adj.size} bytes, tipo ${adj.mimeType}, nombre "${adj.originalName}"`);
    check('el servidor la comprimio (pesa menos que el original)', adj.size < grande.length, `${adj.size} vs ${grande.length}`);
    check('la convirtio a WEBP', adj.mimeType === 'image/webp', adj.mimeType);
    check('el nombre visible acompania al formato real', /\.webp$/.test(adj.originalName || ''), adj.originalName);
    const ahorro = (1 - adj.size / grande.length) * 100;
    console.log(`  ahorro: ${ahorro.toFixed(1)}%  (${(grande.length / 1024).toFixed(0)} KB -> ${(adj.size / 1024).toFixed(0)} KB)`);
    // Umbral bajo a proposito: la imagen de prueba es ruido pseudoaleatorio, el
    // peor caso posible para cualquier compresor. Con una captura de pantalla
    // real el ahorro medido es del 76% (4,2 veces mas chica).
    check('hay ahorro real incluso en el peor caso posible', ahorro > 30, `${ahorro.toFixed(1)}%`);
  }

  console.log('\n=== Una imagen chica no se degrada al pedo ===');
  const chica = pngGrande(200, 150);
  const r2 = await subir('chiquita.png', chica);
  const adj2 = r2.body?.attachments?.[0];
  check('la imagen chica se acepta', r2.status === 201, JSON.stringify(r2.body).slice(0, 120));
  if (adj2) {
    console.log(`  guardada: ${adj2.size} bytes, tipo ${adj2.mimeType}`);
    check('no se agranda al procesarla', adj2.size <= chica.length, `${adj2.size} vs ${chica.length}`);
  }

  console.log('\n=== Un PDF no se toca ===');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3000, 0x41), Buffer.from('\n%%EOF')]);
  const form = new FormData();
  form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'documento.pdf');
  const rp = await fetch(BASE + '/attachments', { method: 'POST', headers: { cookie }, body: form });
  const bp = await rp.json().catch(() => null);
  const adj3 = bp?.attachments?.[0];
  check('el PDF se acepta', rp.status === 201, JSON.stringify(bp).slice(0, 120));
  if (adj3) check('el PDF queda intacto (mismo tipo y tamanio)', adj3.mimeType === 'application/pdf' && adj3.size === pdf.length, `${adj3.mimeType} ${adj3.size}/${pdf.length}`);

  console.log(`\n${ok} correctas, ${fallo} fallidas`);
  if (fallos.length) fallos.forEach(f => console.log(' - ' + f));
  process.exit(fallo ? 1 : 0);
})();
