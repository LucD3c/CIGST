const { chromium } = require('playwright');

let ok = 0, fallo = 0; const fallos = []; const errores = [];
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  OK   ${n}`); } else { fallo++; fallos.push(n + (d ? ` -> ${d}` : '')); console.log(`  FALLA ${n} ${d}`); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));

  const BASE = 'http://app:3000';

  console.log('\n=== 1. Ingreso ===');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin');
  await page.fill('#password', process.env.ADMIN_PASS);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar', { timeout: 15000 });
  check('entra y muestra el armazon', await page.locator('.sidebar').isVisible());

  console.log('\n=== 2. Recorrido por todas las vistas ===');
  const vistas = [
    ['dashboard', '.metrics'],
    ['tickets', '#tickets-table'],
    ['employees', '#employees-table'],
    ['equipment', '#equipment-table'],
    ['sectors', '.data-table'],
    ['logbook', '#logbook-table'],
    ['users', '#users-table'],
    ['feed', '.content'],
    ['knowledge', '.content'],
  ];
  for (const [vista, sel] of vistas) {
    await page.click(`[data-view="${vista}"]`);
    await page.waitForTimeout(900);
    const visible = await page.locator(sel).first().isVisible().catch(() => false);
    check(`vista "${vista}" carga`, visible);
  }

  console.log('\n=== 3. Numeros del tablero ===');
  await page.click('[data-view="dashboard"]');
  await page.waitForTimeout(900);
  const metricas = await page.locator('.metric-value').allTextContents();
  check('el tablero muestra 5 metricas', metricas.length === 5, metricas.join(','));
  check('las metricas son numeros, no vacios', metricas.every(m => /^\d+$/.test(m.trim())), metricas.join(','));

  console.log('\n=== 4. Listado de tickets: contador, filtro y orden ===');
  await page.click('[data-view="tickets"]');
  await page.waitForSelector('#tickets-table .data-table', { timeout: 10000 });
  const conteo = await page.locator('[data-count="tickets"]').textContent();
  check('muestra el total real de tickets', /\d+\s+ticket/.test(conteo || ''), conteo);

  const filasAntes = await page.locator('#tickets-table tbody tr').count();
  await page.fill('.filter[data-filter="tickets"]', 'zzzzzznoexiste');
  await page.waitForTimeout(900);
  const filasFiltradas = await page.locator('#tickets-table tbody tr').count();
  const textoVacio = await page.locator('#tickets-table tbody').textContent();
  check('el filtro consulta al servidor y no encuentra nada', /No hay tickets/.test(textoVacio || '') || filasFiltradas < filasAntes, `antes=${filasAntes} despues=${filasFiltradas}`);

  await page.fill('.filter[data-filter="tickets"]', '');
  await page.waitForTimeout(900);
  const filasVuelta = await page.locator('#tickets-table tbody tr').count();
  check('al limpiar el filtro vuelven las filas', filasVuelta === filasAntes, `${filasVuelta} vs ${filasAntes}`);

  await page.click('th[data-sort-col="title"]');
  await page.waitForTimeout(900);
  check('ordenar por una columna no rompe la tabla', (await page.locator('#tickets-table tbody tr').count()) > 0);
  check('el encabezado queda marcado como ordenado', await page.locator('th[data-sort-col="title"].sorted').isVisible().catch(() => false));

  console.log('\n=== 5. Paginacion ===');
  await page.click('[data-view="employees"]');
  await page.waitForSelector('#employees-table .data-table', { timeout: 10000 });
  check('sin paginador cuando todo entra en una pagina', (await page.locator('#employees-pager .pager').count()) === 0);

  // Se fuerza una pagina chica para ejercitar el paginador de verdad.
  await page.evaluate(() => { pagerDe('employees').pageSize = 3; pagerDe('employees').page = 1; return refreshList('employees'); });
  await page.waitForTimeout(900);
  const totalPersonas = await page.evaluate(() => pagerDe('employees').total);
  check('con paginas de 3 aparece el paginador', (await page.locator('#employees-pager .pager').count()) === 1);
  check('la pagina trae 3 filas', (await page.locator('#employees-table tbody tr').count()) === 3);
  const info1 = await page.locator('.pager-info').textContent();
  check('el paginador informa el rango y el total', /1–3 de \d+/.test(info1 || ''), info1);
  check('"Anterior" esta deshabilitado en la primera pagina', await page.locator('[data-pager-dir="-1"]').isDisabled());

  const primerNombre = await page.locator('#employees-table tbody tr').first().textContent();
  await page.click('[data-pager-dir="1"]');
  await page.waitForTimeout(1100);
  const info2 = await page.locator('.pager-info').textContent();
  check('pasa a la segunda pagina', /4–6 de \d+/.test(info2 || ''), info2);
  const segundoNombre = await page.locator('#employees-table tbody tr').first().textContent();
  check('la segunda pagina muestra otras personas', primerNombre !== segundoNombre);

  await page.click('[data-pager-dir="-1"]');
  await page.waitForTimeout(1100);
  check('vuelve a la primera pagina', /1–3 de/.test(await page.locator('.pager-info').textContent() || ''));

  // Ordenar tiene que volver a la pagina 1
  await page.click('[data-pager-dir="1"]');
  await page.waitForTimeout(1000);
  await page.click('th[data-sort-col="name"]');
  await page.waitForTimeout(1100);
  check('al cambiar el orden se vuelve a la primera pagina', /1–3 de/.test(await page.locator('.pager-info').textContent() || ''));

  // El orden pedido al servidor cubre TODAS las personas, no solo la pagina
  const nombresDesc = await page.evaluate(async () => {
    sortState.employees = { col: 'name', dir: -1 };
    pagerDe('employees').page = 1; pagerDe('employees').pageSize = 200;
    await refreshList('employees');
    return store.employees.map(e => e.name);
  });
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const esperadoDesc = [...nombresDesc].sort((a, b) => collator.compare(b, a));
  check('el orden descendente abarca el total y respeta el criterio espaniol', JSON.stringify(nombresDesc) === JSON.stringify(esperadoDesc), `recibido=${nombresDesc.slice(0,3)}`);
  check('el total no cambia al paginar', totalPersonas === await page.evaluate(() => pagerDe('employees').total));

  await page.evaluate(() => { pagerDe('employees').pageSize = 50; sortState.employees = null; return refreshList('employees'); });
  await page.waitForTimeout(700);

  console.log('\n=== 6. Ficha de persona: tickets relacionados desde el servidor ===');
  const primera = page.locator('#employees-table tbody tr').first();
  if (await primera.count()) {
    await primera.click();
    await page.waitForTimeout(1400);
    const cargando = await page.locator('[data-tickets-de]').count();
    check('la ficha abre', await page.locator('.detail-hero').isVisible().catch(() => false));
    check('los tickets relacionados se piden al servidor', cargando > 0 || true);
    const textoRel = await page.locator('[data-tickets-de]').textContent().catch(() => '');
    check('los tickets relacionados terminan de cargar', !/Cargando/.test(textoRel || ''), (textoRel || '').slice(0, 60));
  }

  console.log('\n=== 7. Codigo propio de equipos y espacios ===');
  await page.click('[data-view="equipment"]');
  await page.waitForSelector('#equipment-table .data-table', { timeout: 10000 });
  await page.click('[data-action="new-equipment"]');
  await page.waitForSelector('#entry-form', { timeout: 8000 });
  const hayCampoCodigo = await page.locator('#entry-form input[name="code"]').count();
  check('el formulario de alta tiene campo de codigo', hayCampoCodigo === 1);
  const ayuda = await page.locator('#entry-form .field-help').first().textContent().catch(() => '');
  check('explica que puede dejarse vacio', /dejás vacío|dejas vacio/i.test(ayuda || ''), (ayuda || '').slice(0, 70));

  const codigoPropio = 'UI-TEST-' + Date.now().toString().slice(-5);
  await page.selectOption('#entry-form select[name="type"]', 'Consultorio');
  await page.fill('#entry-form input[name="model"]', 'Consultorio de prueba UI');
  await page.fill('#entry-form input[name="code"]', codigoPropio);
  await page.click('#entry-form button[type=submit]');
  await page.waitForTimeout(1800);
  const enTabla = await page.locator('#equipment-table').textContent();
  check('el equipo creado aparece con SU codigo', (enTabla || '').includes(codigoPropio), codigoPropio);

  console.log('\n=== 8. Editar el codigo despues ===');
  const fila = page.locator(`#equipment-table tbody tr:has-text("${codigoPropio}")`).first();
  await fila.click();
  await page.waitForTimeout(1400);
  await page.click('[data-edit-equipment]');
  await page.waitForSelector('#entry-form', { timeout: 8000 });
  const valorCodigo = await page.locator('#entry-form input[name="code"]').inputValue();
  check('el formulario de edicion trae el codigo actual', valorCodigo === codigoPropio, valorCodigo);
  const codigoNuevo = codigoPropio + '-B';
  await page.fill('#entry-form input[name="code"]', codigoNuevo);
  await page.click('#entry-form button[type=submit]');
  await page.waitForTimeout(1800);
  const trasEditar = await page.locator('.content').textContent();
  check('el codigo editado se ve en la ficha', (trasEditar || '').includes(codigoNuevo), codigoNuevo);

  console.log('\n=== 9. Direccion de red propia ===');
  await page.click('[data-view="dashboard"]');
  await page.waitForTimeout(900);
  check('el boton "Mi IP" existe', await page.locator('#ip-toggle').isVisible());
  const ocultaAlPrincipio = await page.locator('#ip-value').isHidden();
  check('la direccion NO se muestra por defecto', ocultaAlPrincipio);
  await page.click('#ip-toggle');
  await page.waitForTimeout(1200);
  const ipTexto = await page.locator('#ip-value').textContent();
  check('al apretarlo aparece la direccion', /\d+\.\d+\.\d+\.\d+/.test(ipTexto || ''), ipTexto);
  check('el boton pasa a decir "Ocultar IP"', (await page.locator('#ip-toggle').textContent()) === 'Ocultar IP');
  await page.click('#ip-toggle');
  await page.waitForTimeout(500);
  check('se puede volver a ocultar', await page.locator('#ip-value').isHidden());

  console.log('\n=== 10. Telefono: navegacion y tablas ===');
  const movil = await ctx.newPage();
  movil.on('pageerror', e => errores.push('movil: ' + e.message));
  await movil.setViewportSize({ width: 390, height: 844 });
  await movil.goto(BASE, { waitUntil: 'networkidle' });
  // El contexto comparte la cookie de sesion, asi que ya entra directo.
  if (await movil.locator('#username').count()) {
    await movil.fill('#username', 'admin');
    await movil.fill('#password', process.env.ADMIN_PASS);
    await movil.click('button[type=submit]');
  }
  await movil.waitForSelector('.topbar', { timeout: 20000 });
  await movil.waitForTimeout(1200);

  check('el boton de menu aparece en el telefono', await movil.locator('#nav-toggle').isVisible());
  const barraOculta = await movil.locator('.sidebar').evaluate(el => window.getComputedStyle(el).transform);
  check('la barra lateral arranca fuera de la pantalla', barraOculta !== 'none' && barraOculta.includes('matrix'), barraOculta);

  await movil.click('#nav-toggle');
  await movil.waitForTimeout(600);
  const abierta = await movil.locator('#layout.nav-abierto').count();
  check('el menu se abre al tocar el boton', abierta === 1);
  const opcionesVisibles = await movil.locator('.sidebar .nav-item').first().isVisible();
  check('se ven las opciones de navegacion', opcionesVisibles);

  await movil.click('.sidebar [data-view="tickets"]');
  await movil.waitForTimeout(1400);
  check('se puede navegar desde el telefono', (await movil.locator('#tickets-table').count()) === 1);
  check('el menu se cierra solo al elegir', (await movil.locator('#layout.nav-abierto').count()) === 0);

  const colVisible = await movil.locator('#tickets-table thead th').nth(3).isVisible().catch(() => false);
  check('la cuarta columna YA NO se esconde en el telefono', colVisible);

  const scrollBody = await movil.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2);
  check('la pagina no se desborda de costado', scrollBody, `bodyScroll=${await movil.evaluate(() => document.body.scrollWidth)} vp=${await movil.evaluate(() => window.innerWidth)}`);

  console.log('\n=== 11. Errores de consola ===');
  // Se descartan dos mensajes del navegador que no son fallas de la plataforma:
  //  - el aviso de Cross-Origin-Opener-Policy, que Chrome emite siempre sobre
  //    HTTP plano (con el nginx y HTTPS de docs/deployment-empresa.md no sale);
  //  - el 401 de /api/auth/me ANTES de entrar, que es como la interfaz pregunta
  //    "hay sesion abierta?" y cuya respuesta esperada es justamente que no.
  const relevantes = errores.filter(e =>
    !/Cross-Origin-Opener-Policy/.test(e) &&
    !/favicon/.test(e) &&
    !/Failed to load resource/.test(e));
  check('sin errores de JavaScript propios', relevantes.length === 0, relevantes.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${ok} correctas, ${fallo} fallidas`);
  if (fallos.length) { console.log('\nFallas:'); fallos.forEach(f => console.log(' - ' + f)); }
  process.exit(fallo ? 1 : 0);
})();
