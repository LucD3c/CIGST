// Prueba de carga: 70 personas trabajando a la vez, como pidio el pliego.
// Cada una entra, mira el tablero, recorre listados, abre fichas y mantiene
// abierta su conexion de tiempo real, igual que en un dia normal.
const WebSocket = require('ws');

const BASE = 'http://app:3000';
const USUARIOS = 70;
const RONDAS = 5;

const tiempos = [];
const errores = [];

async function pedir(cookie, ruta) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/api' + ruta, { headers: cookie ? { cookie } : {} });
  const ms = Date.now() - t0;
  tiempos.push({ ruta: ruta.split('?')[0], ms, status: res.status });
  if (res.status >= 400) errores.push(`${res.status} ${ruta}`);
  await res.arrayBuffer();
  return { status: res.status, ms };
}

async function entrar(usuario, clave) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: clave }),
  });
  if (res.status !== 200) { errores.push(`login ${usuario}: ${res.status}`); return null; }
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

function abrirSocket(cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { cookie } });
    const t = setTimeout(() => { errores.push('socket sin abrir'); resolve(null); }, 15000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', () => { clearTimeout(t); errores.push('socket con error'); resolve(null); });
  });
}

// Un dia normal: mirar el tablero, la lista de tickets, personas, equipos,
// abrir una ficha, revisar avisos.
async function jornada(cookie) {
  await pedir(cookie, '/tickets/stats');
  await pedir(cookie, '/tickets?page=1&pageSize=50&estado=activos');
  await pedir(cookie, '/employees?page=1&pageSize=50');
  await pedir(cookie, '/equipment?page=1&pageSize=50');
  await pedir(cookie, '/notifications');
  await pedir(cookie, '/chat/unread-count');
}

(async () => {
  const clave = process.env.ADMIN_PASS;
  console.log(`\nAbriendo ${USUARIOS} sesiones simultaneas...`);

  const t0 = Date.now();
  // 70 cuentas DISTINTAS: los limites de la plataforma son por cuenta, asi que
  // usar la misma 70 veces media el limitador, no el rendimiento.
  const cookies = await Promise.all(
    Array.from({ length: USUARIOS }, (_, i) => entrar(`carga${String(i + 1).padStart(2, '0')}`, 'Prueba-Carga-77')),
  );
  const validas = cookies.filter(Boolean);
  console.log(`  ${validas.length}/${USUARIOS} sesiones abiertas en ${Date.now() - t0} ms`);

  console.log(`Abriendo ${validas.length} conexiones de tiempo real...`);
  const t1 = Date.now();
  const sockets = (await Promise.all(validas.map(abrirSocket))).filter(Boolean);
  console.log(`  ${sockets.length}/${validas.length} sockets conectados en ${Date.now() - t1} ms`);

  console.log(`\nSimulando ${RONDAS} rondas de trabajo simultaneo (${validas.length} personas a la vez)...`);
  const t2 = Date.now();
  for (let r = 1; r <= RONDAS; r++) {
    const tr = Date.now();
    await Promise.all(validas.map(jornada));
    console.log(`  ronda ${r}: ${Date.now() - tr} ms`);
  }
  const totalMs = Date.now() - t2;

  sockets.forEach(ws => ws.close());

  // --- Resultados ---
  const porRuta = {};
  for (const t of tiempos) {
    (porRuta[t.ruta] = porRuta[t.ruta] || []).push(t.ms);
  }
  console.log('\n  Tiempo de respuesta por endpoint (ms):');
  console.log('    ruta                              n     medio   p95    max');
  for (const [ruta, ms] of Object.entries(porRuta)) {
    const ord = [...ms].sort((a, b) => a - b);
    const medio = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
    const p95 = ord[Math.floor(ord.length * 0.95)];
    console.log(`    ${ruta.padEnd(32)} ${String(ms.length).padStart(4)}  ${String(medio).padStart(6)} ${String(p95).padStart(6)} ${String(ord[ord.length - 1]).padStart(6)}`);
  }

  const todos = tiempos.map(t => t.ms).sort((a, b) => a - b);
  const p95Global = todos[Math.floor(todos.length * 0.95)];
  console.log(`\n  Total de peticiones: ${tiempos.length} en ${totalMs} ms`);
  console.log(`  Rendimiento: ${Math.round(tiempos.length / (totalMs / 1000))} peticiones por segundo`);
  console.log(`  p95 global: ${p95Global} ms   maximo: ${todos[todos.length - 1]} ms`);
  console.log(`  Errores: ${errores.length}`);
  if (errores.length) console.log('   ' + [...new Set(errores)].slice(0, 5).join('\n   '));

  const bien = errores.length === 0 && p95Global < 1500;
  console.log(`\n  RESULTADO: ${bien ? 'BIEN' : 'REVISAR'} (sin errores y p95 por debajo de 1,5 s)`);
  process.exit(bien ? 0 : 1);
})();
