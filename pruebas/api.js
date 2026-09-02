// Pruebas de la ronda de correcciones, contra la plataforma real.
const BASE = 'http://app:3000/api';
let cookie = '';
let ok = 0, fallo = 0;
const fallos = [];

function check(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`  OK   ${nombre}`); }
  else { fallo++; fallos.push(nombre + (detalle ? ` -> ${detalle}` : '')); console.log(`  FALLA ${nombre} ${detalle}`); }
}

async function api(ruta, opts = {}) {
  const res = await fetch(BASE + ruta, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let cuerpo = null;
  try { cuerpo = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body: cuerpo };
}

(async () => {
  console.log('\n=== 1. Salud y sesion ===');
  const salud = await api('/health');
  check('/health consulta la base de datos', salud.status === 200 && salud.body.db === 'ok', JSON.stringify(salud.body));

  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: process.env.ADMIN_PASS } });
  check('login de administrador', login.status === 200, JSON.stringify(login.body).slice(0, 120));
  if (login.status !== 200) { console.log('sin sesion, se corta'); process.exit(1); }

  console.log('\n=== 2. Direccion de red propia ===');
  const ip = await api('/auth/mi-ip');
  check('/auth/mi-ip responde', ip.status === 200 && !!ip.body.red, JSON.stringify(ip.body));
  check('devuelve una direccion', !!ip.body.red?.ip, JSON.stringify(ip.body.red));
  check('la reconoce como privada (red interna)', ip.body.red?.esPrivada === true, JSON.stringify(ip.body.red));

  console.log('\n=== 3. Paginacion ===');
  for (const [ruta, clave] of [['/tickets', 'tickets'], ['/employees', 'employees'], ['/equipment', 'equipment'], ['/users', 'users'], ['/logbook', 'entries']]) {
    const r = await api(`${ruta}?page=1&pageSize=3`);
    check(`${ruta} pagina`, r.status === 200 && Array.isArray(r.body[clave]) && r.body[clave].length <= 3 && typeof r.body.total === 'number', `status=${r.status} total=${r.body?.total} n=${r.body?.[clave]?.length}`);
  }
  const tope = await api('/tickets?pageSize=100000');
  check('el tope de pagina lo impone el servidor (no el cliente)', tope.status === 400 || (tope.body.pageSize ?? 0) <= 200, `status=${tope.status} pageSize=${tope.body?.pageSize}`);

  console.log('\n=== 4. Orden alfabetico espaniol desde la base ===');
  const ordenados = await api('/employees?sort=name&dir=asc&pageSize=200');
  const nombres = (ordenados.body.employees || []).map(e => e.name);
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const esperado = [...nombres].sort(collator.compare);
  check('el orden que manda la base coincide con el criterio espaniol', JSON.stringify(nombres) === JSON.stringify(esperado), `base=${nombres.slice(0, 4)} | esperado=${esperado.slice(0, 4)}`);

  console.log('\n=== 5. Numeros del tablero calculados por la base ===');
  const stats = await api('/tickets/stats');
  const todos = await api('/tickets?estado=todos&pageSize=200');
  const abiertosReales = (todos.body.tickets || []).filter(t => !['Resuelto', 'Cerrado', 'Cancelado'].includes(t.status)).length;
  check('/tickets/stats responde', stats.status === 200 && stats.body.estadisticas, JSON.stringify(stats.body).slice(0, 100));
  check('el total de tickets coincide', stats.body.estadisticas?.total === todos.body.total, `stats=${stats.body.estadisticas?.total} lista=${todos.body.total}`);
  check('los abiertos coinciden con el conteo real', stats.body.estadisticas?.abiertos === abiertosReales, `stats=${stats.body.estadisticas?.abiertos} real=${abiertosReales}`);

  console.log('\n=== 6. Filtro de estado resuelto por el servidor ===');
  const activos = await api('/tickets?estado=activos&pageSize=200');
  const hayCerrados = (activos.body.tickets || []).some(t => ['Cerrado', 'Cancelado'].includes(t.status));
  check('estado=activos no devuelve cerrados ni cancelados', !hayCerrados);

  console.log('\n=== 7. Codigo propio de equipos y espacios ===');
  const marca = Date.now().toString().slice(-6);
  const conCodigo = await api('/equipment', { method: 'POST', body: { type: 'PC', model: `Prueba codigo ${marca}`, code: `PC-TEST-${marca}` } });
  check('se puede crear con codigo propio', conCodigo.status === 201 && conCodigo.body.equipment?.code === `PC-TEST-${marca}`, JSON.stringify(conCodigo.body).slice(0, 150));

  const duplicado = await api('/equipment', { method: 'POST', body: { type: 'PC', model: 'Otro', code: `PC-TEST-${marca}` } });
  check('rechaza un codigo repetido con mensaje claro', duplicado.status === 409 && /ya lo tiene|ya está en uso/i.test(duplicado.body?.error || ''), `status=${duplicado.status} ${duplicado.body?.error}`);

  const sinCodigo = await api('/equipment', { method: 'POST', body: { type: 'Monitor', model: `Prueba auto ${marca}` } });
  check('sin codigo, lo genera la plataforma', sinCodigo.status === 201 && /^EQ-\d+$/.test(sinCodigo.body.equipment?.code || ''), sinCodigo.body?.equipment?.code);

  const idEq = conCodigo.body.equipment?.id;
  const editado = await api(`/equipment/${idEq}`, { method: 'PATCH', body: { code: `PC-EDIT-${marca}` } });
  check('se puede editar el codigo despues', editado.status === 200 && editado.body.equipment?.code === `PC-EDIT-${marca}`, JSON.stringify(editado.body).slice(0, 120));
  check('el cambio de codigo queda en el historial', /Código/.test(editado.body.equipment?.changeLog || ''), (editado.body.equipment?.changeLog || '').slice(0, 80));

  const codigoMalo = await api('/equipment', { method: 'POST', body: { type: 'PC', model: 'Malo', code: 'PC<script>' } });
  check('rechaza un codigo con caracteres raros', codigoMalo.status === 400, `status=${codigoMalo.status}`);

  console.log('\n=== 8. Codigos correlativos sin condicion de carrera ===');
  const enParalelo = await Promise.all(
    Array.from({ length: 8 }, (_, i) => api('/equipment', { method: 'POST', body: { type: 'Teclado', model: `Carrera ${marca}-${i}` } })),
  );
  const creados = enParalelo.filter(r => r.status === 201);
  const codigos = creados.map(r => r.body.equipment.code);
  check('8 altas simultaneas: todas exitosas', creados.length === 8, `exitosas=${creados.length} status=${enParalelo.map(r => r.status)}`);
  check('8 altas simultaneas: ningun codigo repetido', new Set(codigos).size === codigos.length, codigos.join(','));

  console.log('\n=== 9. Politica de contrasenas ===');
  const debiles = [
    ['12345678', 'numeros consecutivos'],
    ['password', 'contrasena comun'],
    ['aaaaaaaaaaaa', 'caracteres repetidos'],
    ['abcdefghij', 'secuencia alfabetica'],
    ['todominus10', 'sin variedad de tipos'],
  ];
  for (const [clave, motivo] of debiles) {
    const r = await api('/users', { method: 'POST', body: { name: 'Prueba', username: `pr${marca}`, password: clave, role: 'Supervisor' } });
    check(`rechaza "${clave}" (${motivo})`, r.status === 400, `status=${r.status}`);
  }
  const buena = await api('/users', { method: 'POST', body: { name: 'Prueba Politica', username: `pol${marca}`, password: 'Roble-Verde-72', role: 'Supervisor' } });
  check('acepta una contrasena razonable y memorable', buena.status === 201, JSON.stringify(buena.body).slice(0, 150));
  const conUsuario = await api('/users', { method: 'POST', body: { name: 'X', username: `martinez${marca}`, password: `Martinez${marca}!A`, role: 'Supervisor' } });
  check('rechaza la contrasena que contiene el usuario', conUsuario.status === 400, `status=${conUsuario.status}`);

  console.log('\n=== 10. Busqueda en bases de conocimiento ===');
  const corta = await api('/knowledge/search?q=a');
  check('exige al menos 2 caracteres para buscar', corta.status === 400, `status=${corta.status}`);
  const busq = await api('/knowledge/search?q=re');
  check('la busqueda responde', busq.status === 200, `status=${busq.status}`);

  console.log('\n=== RESUMEN ===');
  console.log(`${ok} correctas, ${fallo} fallidas`);
  if (fallos.length) { console.log('\nFallas:'); fallos.forEach(f => console.log(' - ' + f)); }
  process.exit(fallo ? 1 : 0);
})();
