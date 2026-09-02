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

(async () => {
  await api('/auth/login', { method: 'POST', body: { username: 'admin', password: process.env.ADMIN_PASS } });
  const marca = Date.now().toString().slice(-7);

  console.log('\n=== Busqueda dentro del contenido de los articulos ===');

  // Base + seccion + articulo con el termino SOLO en el cuerpo, no en el titulo.
  const espacio = await api('/knowledge/spaces', { method: 'POST', body: { name: `Base prueba ${marca}`, description: 'prueba' } });
  check('se crea la base', espacio.status === 201, JSON.stringify(espacio.body).slice(0, 150));
  const spaceId = espacio.body.space?.id;

  const seccion = await api(`/knowledge/spaces/${spaceId}/sections`, { method: 'POST', body: { name: 'Seccion prueba' } });
  check('se crea la seccion', seccion.status === 201, JSON.stringify(seccion.body).slice(0, 150));
  const sectionId = seccion.body.section?.id;

  const termino = `xilofono${marca}`;
  const secreto = `clavesecreta${marca}`;
  const art = await api('/knowledge/articles', {
    method: 'POST',
    body: {
      sectionId,
      title: `Articulo sin el termino en el titulo ${marca}`,
      blocks: [
        { kind: 'texto', data: { texto: `Este cuerpo menciona ${termino} en el medio del parrafo.` } },
        { kind: 'tarjeta', data: { titulo: 'Acceso', campos: [{ etiqueta: 'Contraseña', valor: secreto, oculto: true }] } },
      ],
    },
  });
  check('se crea el articulo con contenido y un campo oculto', art.status === 201, JSON.stringify(art.body).slice(0, 250));

  // Buscar por una palabra que SOLO esta en el cuerpo
  const porCuerpo = await api(`/knowledge/search?q=${termino}`);
  const encontrado = (porCuerpo.body.results || porCuerpo.body || []).some?.(r => r.id === art.body.article?.id)
    || JSON.stringify(porCuerpo.body).includes(art.body.article?.id || '###');
  check('encuentra el articulo por una palabra del CUERPO', porCuerpo.status === 200 && encontrado, JSON.stringify(porCuerpo.body).slice(0, 250));

  // Buscar el valor de un campo OCULTO: no debe encontrarlo
  const porOculto = await api(`/knowledge/search?q=${secreto}`);
  const filtrado = JSON.stringify(porOculto.body).includes(art.body.article?.id || '###');
  check('NO encuentra el articulo buscando el valor de un campo oculto', porOculto.status === 200 && !filtrado, JSON.stringify(porOculto.body).slice(0, 250));

  // Editar el contenido: el texto buscable tiene que actualizarse
  const nuevoTermino = `marimba${marca}`;
  const editado = await api(`/knowledge/articles/${art.body.article?.id}`, {
    method: 'PATCH',
    body: { blocks: [{ kind: 'texto', data: { texto: `Ahora dice ${nuevoTermino} en lugar de lo anterior.` } }] },
  });
  check('se edita el articulo', editado.status === 200, JSON.stringify(editado.body).slice(0, 150));

  const trasEditar = await api(`/knowledge/search?q=${nuevoTermino}`);
  check('encuentra por el contenido NUEVO tras editar', JSON.stringify(trasEditar.body).includes(art.body.article?.id || '###'), JSON.stringify(trasEditar.body).slice(0, 200));

  const viejoYa = await api(`/knowledge/search?q=${termino}`);
  check('ya NO encuentra por el contenido viejo', !JSON.stringify(viejoYa.body).includes(art.body.article?.id || '###'), JSON.stringify(viejoYa.body).slice(0, 200));

  // limpieza: se da de baja la base de prueba
  await api(`/knowledge/spaces/${spaceId}`, { method: 'DELETE' });

  console.log(`\n${ok} correctas, ${fallo} fallidas`);
  if (fallos.length) fallos.forEach(f => console.log(' - ' + f));
  process.exit(fallo ? 1 : 0);
})();
