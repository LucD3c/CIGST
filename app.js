/* CIGST: interfaz operativa conectada al backend real (sin localStorage). */
const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');

/* ---------- Cliente API ---------- */
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const err = new Error('No se pudo conectar con el servidor.');
    err.status = 0;
    throw err;
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}
function apiErrorMessage(err) {
  const fieldErrors = err?.details?.fieldErrors;
  if (fieldErrors) {
    const first = Object.values(fieldErrors).find(list => Array.isArray(list) && list.length);
    if (first) return first[0];
  }
  return err?.message || 'Ocurrió un error inesperado.';
}
function handleApiError(err) {
  if (err?.status === 401) {
    session = false; currentUser = null;
    stopChatUnreadPolling(); stopChatThreadPolling();
    loginView();
    toast('Tu sesión expiró. Iniciá sesión nuevamente.');
    return;
  }
  toast(apiErrorMessage(err));
}

/* ---------- Estado ---------- */
let store = { employees: [], equipment: [], tickets: [], logbook: [], users: [], technicians: [], sectors: [], schedules: [], activity: [] };
let currentUser = null;
let session = false;
let currentView = 'dashboard';

/* ---------- Chat interno: estado + intervalos de polling (constantes, no numeros sueltos) ---------- */
const CHAT_THREAD_POLL_MS = 4000;
const CHAT_UNREAD_POLL_MS = 15000;
let chatConversations = [];
let activeChatConversationId = null;
let chatMessages = [];
let chatUnreadCount = 0;
let chatThreadPollHandle = null;
let chatUnreadPollHandle = null;

/* ---------- Normalizadores (API -> forma que usa la interfaz) ---------- */
function normalizeEmployee(e) {
  return {
    id: e.id, code: e.code, name: e.name, document: e.document || '—', email: e.email || '',
    phone: e.phone || '', extension: e.extension || '', sectorId: e.sectorId || '', sectorName: e.sector?.name || '',
    position: e.position || '', status: e.status, workShift: e.workShift || '', schedule: e.schedule || '',
    replacement: e.replacementId || '', replacementInfo: e.replacement || null, notes: e.notes || '',
    sectorEquipment: (e.sectorEquipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
  };
}
function normalizeEquipment(e) {
  return {
    id: e.id, code: e.code, type: e.type, model: e.model || '', status: e.status,
    sectorId: e.sectorId || '', sectorName: e.sector?.name || '', notes: e.notes || '',
  };
}
function normalizeTicket(t) {
  return {
    id: t.id, code: t.code, title: t.title, description: t.description || '',
    employee: t.employeeId, requestedBy: t.requestedById || '',
    equipment: t.equipmentId || '', sectorId: t.sectorId || '', sectorName: t.sector?.name || '',
    scheduleId: t.scheduleId || '', scheduleInfo: t.schedule || null, category: t.category || 'General',
    technician: t.technician?.name || '', technicianId: t.technicianId || '',
    status: t.status, priority: t.priority, solution: t.solution || '', time: t.timeSpent || '',
    createdAt: t.createdAt, updatedAt: t.updatedAt, createdByName: t.createdBy?.name || '',
    employeeInfo: t.employee || null, requestedByInfo: t.requestedBy || null,
    sectorInfo: t.sector || null, equipmentInfo: t.equipment || null,
  };
}
function normalizeLogbookEntry(x) {
  return {
    id: x.id, code: x.code, title: x.title, category: x.category,
    date: (x.occurredAt || x.createdAt || '').slice(0, 10), author: x.author?.name || '', detail: x.detail || '',
  };
}
function normalizeUser(u) {
  return {
    id: u.id, name: u.name, username: u.username, role: u.role?.name || u.role, status: u.status,
    lastAccess: u.lastAccessAt ? new Date(u.lastAccessAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—',
    logins: u.loginCount, employeeId: u.employeeId || '',
  };
}
function normalizeSector(s) {
  return {
    id: s.id, name: s.name, status: s.status,
    people: (s.people || []).map(p => ({ id: p.id, name: p.name, status: p.status })),
    equipmentList: (s.equipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
  };
}
function normalizeSchedule(s) {
  return { id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime, status: s.status };
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/* ---------- Carga de datos por sesion/vista ---------- */
function applySessionUser(user) {
  currentUser = { id: user.id, name: user.name, role: user.role, employeeId: user.employeeId || '', initials: user.name.split(' ').map(x => x[0]).slice(0, 2).join('') };
  session = true;
  chatConversations = []; activeChatConversationId = null; chatMessages = []; chatUnreadCount = 0;
  startChatUnreadPolling();
  const ctx = user.employee;
  if (ctx) {
    store.employees = [{ id: ctx.id, code: '', name: ctx.name, document: '—', email: '', phone: '', extension: ctx.extension || '', sectorId: ctx.sectorId || '', sectorName: ctx.sectorName || '', position: '', status: 'Activo', workShift: ctx.workShift || '', schedule: ctx.schedule || '', replacement: '', replacementInfo: null, notes: '', sectorEquipment: [] }];
    store.equipment = ctx.equipment.map(e => ({ id: e.id, code: '', type: e.type || '', model: e.model || '', status: 'Activo', sectorId: ctx.sectorId || '', sectorName: ctx.sectorName || '', notes: '' }));
  } else {
    store.employees = []; store.equipment = [];
  }
  currentView = isStaff() ? 'dashboard' : 'employee-portal';
}
async function loadStaffData() {
  const [employeesRes, equipmentRes, ticketsRes, techniciansRes, sectorsRes, schedulesRes] = await Promise.all([
    api('/employees'), api('/equipment'), api('/tickets'), api('/users/technicians'), api('/sectors'), api('/schedules'),
  ]);
  store.employees = employeesRes.employees.map(normalizeEmployee);
  store.equipment = equipmentRes.equipment.map(normalizeEquipment);
  store.tickets = ticketsRes.tickets.map(normalizeTicket);
  store.technicians = techniciansRes.technicians;
  store.sectors = sectorsRes.sectors.map(normalizeSector);
  store.schedules = schedulesRes.schedules.map(normalizeSchedule);
  if (isAdmin()) {
    const { entries } = await api('/logbook');
    store.logbook = entries.map(normalizeLogbookEntry);
  } else {
    store.logbook = [];
  }
  store.activity = deriveActivity(store.tickets, store.logbook);
}
async function loadUsers() {
  const { users } = await api('/users');
  store.users = users.map(normalizeUser);
}
async function loadEmployeeData() {
  const [ticketsRes, sectorsRes, schedulesRes] = await Promise.all([api('/tickets'), api('/sectors'), api('/schedules')]);
  store.tickets = ticketsRes.tickets.map(normalizeTicket);
  store.sectors = sectorsRes.sectors.map(normalizeSector);
  store.schedules = schedulesRes.schedules.map(normalizeSchedule);
}
function relativeTime(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  return `Hace ${Math.round(hrs / 24)} d`;
}
function deriveActivity(tickets, logbook) {
  const items = [];
  tickets.forEach(t => {
    const updated = t.updatedAt && t.updatedAt !== t.createdAt;
    items.push({
      icon: updated ? '↗' : '+',
      text: updated
        ? `<strong>${esc(t.technician || t.createdByName || 'Soporte')}</strong> actualizó <strong>${esc(t.code)}</strong> · ${esc(t.status)}`
        : `<strong>${esc(t.createdByName || 'Alguien')}</strong> creó <strong>${esc(t.code)}</strong> · ${esc(t.title)}`,
      time: relativeTime(updated ? t.updatedAt : t.createdAt),
      ts: new Date(updated ? t.updatedAt : t.createdAt).getTime(),
    });
  });
  logbook.forEach(x => {
    items.push({ icon: '▤', text: `<strong>${esc(x.author)}</strong> registró <strong>${esc(x.title)}</strong>`, time: relativeTime(x.date), ts: new Date(x.date).getTime() });
  });
  return items.sort((a, b) => b.ts - a.ts).slice(0, 8);
}

/* ---------- Utilidades de presentacion ---------- */
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const employee = id => store.employees.find(x => x.id === id);
const equipment = id => store.equipment.find(x => x.id === id);
const statusClass = value => ({'Crítica':'b-red','Alta':'b-yellow','Nuevo':'b-blue','En proceso':'b-blue','Abierto':'b-blue','Esperando proveedor':'b-yellow','Esperando usuario':'b-yellow','Resuelto':'b-green','Cerrado':'b-green','Activo':'b-green','Inactivo':'b-gray','Bloqueado':'b-red','Baja':'b-gray','Media':'b-blue'}[value] || 'b-gray');
const badge = value => `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
const navItems = [ ['dashboard','⌂','Centro de operaciones'], ['tickets','◈','Tickets'], ['employees','♙','Personas'], ['equipment','▣','Equipamiento'], ['sectors','◫','Sectores'], ['logbook','▤','Bitácora técnica'], ['users','◉','Panel administrador'], ['chat','✉','Mensajes'] ];
const isAdmin = () => currentUser?.role === 'Administrador';
const isSupervisor = () => currentUser?.role === 'Supervisor';
const isStaff = () => currentUser?.role !== 'User';

/* ---------- Vistas ---------- */
function loginView(){app.innerHTML=`<main class="login-page"><section class="login-card"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><h1>Centro de Soporte</h1><p>Ingresá con las credenciales proporcionadas por Sistemas.</p><form id="login-form"><div class="field"><label for="username">Usuario</label><input id="username" name="username" required autocomplete="username" autofocus /></div><div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" /></div><div class="login-actions"><label class="remember"><input type="checkbox" checked /> Recordarme</label><button class="btn btn-primary" type="submit">Iniciar sesión</button></div></form></section></main>`;$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const submitBtn=e.currentTarget.querySelector('button[type=submit]');submitBtn.disabled=true;try{const {user}=await api('/auth/login',{method:'POST',body:{username:form.get('username'),password:form.get('password')}});applySessionUser(user);await render();}catch(err){toast(apiErrorMessage(err));}finally{submitBtn.disabled=false;}});}
function shell(content){const byId=ids=>navItems.filter(([id])=>ids.includes(id));const operacion=byId(['dashboard','tickets']);const informacion=byId(['employees','equipment','sectors']);const administracion=byId(['logbook','users']);const comunicacion=byId(['chat']);const staffNav=`<div class="nav-group">Operación</div>${operacion.map(nav).join('')}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${informacion.map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${administracion.map(nav).join('')}`:''}`;const employeeNav=`<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}`;app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><nav class="nav">${isStaff()?staffNav:employeeNav}</nav><div class="sidebar-user"><strong>${esc(currentUser.name)}</strong><span>${esc(currentUser.role)}</span></div></aside><main class="main"><header class="topbar">${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions"><span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{currentView=el.dataset.view;render();});$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }session=false;currentUser=null;stopChatUnreadPolling();stopChatThreadPolling();chatConversations=[];activeChatConversationId=null;chatMessages=[];chatUnreadCount=0;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
const nav=([id,icon,label])=>{const badge=id==='chat'&&chatUnreadCount>0?`<span class="nav-badge">${chatUnreadCount>99?'99+':chatUnreadCount}</span>`:'';return `<button class="nav-item ${currentView===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;};
function keyHandler(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#global-search')?.focus();}if(e.key==='Escape')closeModal();}
function page(title,subtitle,button=''){return `<div class="page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`}
function dashboard(){const active=store.tickets.filter(t=>!['Resuelto','Cerrado','Cancelado'].includes(t.status));return page('Centro de operaciones','Visión general del soporte técnico.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<section class="metrics"><div class="metric"><div class="metric-label">Abiertos <span>◈</span></div><div class="metric-value">${active.length}</div><div class="metric-meta">requieren seguimiento</div></div><div class="metric urgent"><div class="metric-label">Urgentes <span>!</span></div><div class="metric-value">${store.tickets.filter(t=>t.priority==='Crítica').length}</div><div class="metric-meta">prioridad crítica</div></div><div class="metric live"><div class="metric-label">En proceso <span>↗</span></div><div class="metric-value">${store.tickets.filter(t=>t.status==='En proceso').length}</div><div class="metric-meta">con técnico asignado</div></div><div class="metric"><div class="metric-label">Esperando <span>◷</span></div><div class="metric-value">${store.tickets.filter(t=>t.status.startsWith('Esperando')).length}</div><div class="metric-meta">usuario o proveedor</div></div><div class="metric"><div class="metric-label">Resueltos <span>✓</span></div><div class="metric-value">${store.tickets.filter(t=>['Resuelto','Cerrado'].includes(t.status)).length}</div><div class="metric-meta">histórico registrado</div></div></section><section class="grid"><div class="panel"><div class="panel-head"><h2>Tickets que requieren atención</h2><a data-view="tickets">Ver todos</a></div>${ticketsTable(active)}</div><div class="panel"><div class="panel-head"><h2>Actividad reciente</h2>${isAdmin()?'<a data-view="logbook">Bitácora</a>':''}</div><div class="activity">${store.activity.length?store.activity.map(activity).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'}</div></div></section><section class="two-panels"><div class="panel"><div class="panel-head"><h2>Eventos importantes</h2>${isAdmin()?'<a data-view="logbook">Ver bitácora</a>':''}</div>${isAdmin()?(store.logbook.length?store.logbook.slice(0,3).map(e=>`<div class="event"><strong>${esc(e.title)}</strong><span>${esc(e.category)} · ${e.date} · ${esc(e.author)}</span></div>`).join(''):'<div class="empty">No hay eventos técnicos registrados.</div>'):'<div class="empty">Solo visible para Administrador.</div>'}</div><div class="panel"><div class="panel-head"><h2>Recordatorios</h2></div><div class="empty">No hay recordatorios pendientes.</div></div></section>`}
function ticketsTable(rows){const showActions=isStaff();return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ticket</th><th>Incidencia</th><th>Prioridad</th><th>Estado</th><th>Asignado</th>${showActions?'<th></th>':''}</tr></thead><tbody>${rows.map(t=>`<tr data-ticket="${t.id}"><td class="mono">${esc(t.code)}</td><td><strong>${esc(t.title)}</strong><br><span class="muted">${esc(employee(t.employee)?.name||t.employeeInfo?.name||'Sin empleado')}</span></td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${esc(t.technician||'Sin asignar')}</td>${showActions?`<td class="row-actions"><button class="btn-icon" type="button" data-quick-menu="${t.id}" title="Acciones rápidas">⋮</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${showActions?6:5}" class="empty">No hay tickets en esta vista.</td></tr>`}</tbody></table></div>`}
const activity=a=>`<div class="activity-item"><div class="activity-symbol">${a.icon}</div><div class="activity-copy">${a.text}</div><div class="activity-time">${a.time}</div></div>`;
function ticketsView(){return page('Tickets','Registro y seguimiento de incidencias.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, técnico o número…" data-filter="tickets" /></div><div class="panel" id="tickets-table">${ticketsTable(store.tickets)}</div>`}
function employeePortal(){const person=employee(currentUser.employeeId);const mine=store.tickets.filter(t=>t.employee===currentUser.employeeId);return page('Solicitudes de soporte','Creá una solicitud para el Departamento de Sistemas.',`<button class="btn btn-primary" data-action="new-employee-ticket">+ Solicitar soporte</button>`)+`<section class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><span class="muted">${esc(person?.sectorName||'')}</span></div>${ticketsTable(mine)}</section><section class="panel" style="margin-top:18px"><div class="side-card"><h3>¿Necesitás ayuda?</h3><p class="muted">Describí el problema, elegí la prioridad y, si corresponde, el equipo que estás utilizando. Sistemas recibirá tu solicitud y actualizará el estado.</p></div></section>`}
function employeesView(){return page('Personas','Ficha centralizada de colaboradores y su contexto técnico.',`<button class="btn btn-primary" data-action="new-employee">+ Nueva persona</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, correo, interno o sector…" data-filter="employees" /></div><div class="panel" id="employees-table">${employeesTable(store.employees)}</div>`}
function employeesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Persona</th><th>Sector / Cargo</th><th>Horario</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-employee="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.sectorName||'Sin sector')}<br><span class="muted">${esc(x.position)}</span></td><td>${esc(x.workShift)}<br><span class="muted">${esc(x.schedule)}</span></td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="4" class="empty">No se encontraron personas.</td></tr>`}</tbody></table></div>`}
function equipmentView(){return page('Equipamiento','Inventario simple, vinculado por sector.',`<button class="btn btn-primary" data-action="new-equipment">+ Nuevo equipo</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por tipo, modelo o sector…" data-filter="equipment" /></div><div class="panel" id="equipment-table">${equipmentTable(store.equipment)}</div>`}
function equipmentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Equipo</th><th>Sector</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-equipment="${x.id}"><td><strong>${esc(x.model)||esc(x.type)}</strong><br><span class="muted">${esc(x.type)} · ${esc(x.code)}</span></td><td>${esc(x.sectorName||'Sin sector')}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No se encontraron equipos.</td></tr>`}</tbody></table></div>`}
function logbookView(){return page('Bitácora técnica','Eventos relevantes y cambios de infraestructura.',`<button class="btn btn-primary" data-action="new-log">+ Registrar evento</button>`)+`<section class="panel">${store.logbook.map(x=>`<div class="event"><div class="row-between"><strong>${esc(x.title)}</strong>${badge(x.category)}</div><span>${x.date} · ${esc(x.author)}</span><p class="muted">${esc(x.detail)}</p></div>`).join('')}</section>`}
function usersView(){return page('Panel administrador','Usuarios, roles y accesos de la plataforma.',`<button class="btn btn-primary" data-action="new-user">+ Crear usuario</button>`)+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Ingresos</th></tr></thead><tbody>${store.users.map(x=>`<tr data-user="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="mono">${esc(x.username)}</span></td><td>${esc(x.role)}</td><td>${badge(x.status)}</td><td>${esc(x.lastAccess)}</td><td>${x.logins}</td></tr>`).join('')}</tbody></table></div></section>`}
function employeeDetail(x){const relatedTickets=store.tickets.filter(t=>t.employee===x.id);return page('Ficha de persona','Contexto operativo unificado.')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.name)}</h2><p>${esc(x.position)} · ${esc(x.sectorName||'Sin sector')}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Correo</label>${esc(x.email)}</div><div class="info"><label>Interno</label>${esc(x.extension)}</div><div class="info"><label>Horario</label>${esc(x.workShift)} · ${esc(x.schedule)}</div><div class="info"><label>Reemplazo</label>${esc(x.replacementInfo?.name||'No definido')}</div></div></div><div class="panel-head"><h2>Tickets relacionados</h2></div>${ticketsTable(relatedTickets)}</section><aside><div class="panel side-card"><h3>Equipamiento del sector</h3>${x.sectorEquipment.map(e=>`<div class="event"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">No hay equipamiento registrado en este sector.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Notas técnicas</h3>${x.notes?`<div class="note">${esc(x.notes)}</div>`:'<p class="muted">Sin observaciones registradas.</p>'}</div></aside></div>`}
function equipmentDetail(x){const tickets=store.tickets.filter(t=>t.equipment===x.id);return page('Detalle de equipamiento','Información y tickets asociados.')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.model)||esc(x.type)}</h2><p>${esc(x.type)} · ${esc(x.code)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Sector</label>${esc(x.sectorName||'Sin asignar')}</div></div></div><div class="panel-head"><h2>Tickets asociados</h2></div>${ticketsTable(tickets)}</section><aside><div class="panel side-card"><h3>Observaciones</h3><div class="note">${esc(x.notes||'Sin observaciones registradas.')}</div></div></aside></div>`}
function sectorsView(){return page('Sectores y turnos','Catálogo compartido por Personas, Equipos y Tickets.',`<button class="btn btn-primary" data-action="new-sector">+ Nuevo sector</button>`)+`<div class="panel" id="sectors-table">${sectorsTable(store.sectors)}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Turnos de soporte</h2><button class="btn btn-ghost" data-action="new-schedule">+ Nuevo turno</button></div><div id="schedules-table">${schedulesTable(store.schedules)}</div></section>`}
function sectorsTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Sector</th><th>Estado</th></tr></thead><tbody>${rows.map(s=>`<tr data-sector="${s.id}"><td><strong>${esc(s.name)}</strong></td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay sectores creados todavía.</td></tr>`}</tbody></table></div>`}
function schedulesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Turno</th><th>Horario</th><th>Estado</th></tr></thead><tbody>${rows.map(s=>`<tr data-schedule="${s.id}"><td><strong>${esc(s.name)}</strong></td><td class="mono">${esc(s.startTime)}–${esc(s.endTime)}</td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No hay turnos creados todavía.</td></tr>`}</tbody></table></div>`}
function sectorDetail(x){const peopleRows=x.people.map(p=>`<tr data-employee="${p.id}"><td>${esc(p.name)}</td><td>${badge(p.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay personas en este sector.</td></tr>`;return page('Detalle de sector','Personas y equipos vinculados a este sector.',`<button class="btn btn-ghost" type="button" data-edit-sector="${x.id}">Editar</button>`)+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><h2>${esc(x.name)}</h2>${badge(x.status)}</div></div><div class="panel-head"><h2>Personas (${x.people.length})</h2></div><div class="table-wrap"><table class="data-table"><tbody>${peopleRows}</tbody></table></div></section><aside><div class="panel side-card"><h3>Equipamiento (${x.equipmentList.length})</h3>${x.equipmentList.map(e=>`<div class="event"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">Sin equipamiento en este sector.</p>'}</div></aside></div>`}
function ticketDetail(ticket){const affected=ticket.employeeInfo||employee(ticket.employee);const requester=ticket.requestedByInfo||affected;const device=ticket.equipmentInfo;const shift=ticket.scheduleInfo?`${ticket.scheduleInfo.name} · ${ticket.scheduleInfo.startTime}–${ticket.scheduleInfo.endTime}`:'No indicado';const context=`<div class="form-span"><div class="note"><strong>${esc(ticket.code)} · ${esc(ticket.title)}</strong><br>${esc(ticket.description||'Sin descripción adicional.')}<br><br><b>Persona a asistir:</b> ${esc(affected?.name||'No indicada')} · <b>Solicitó:</b> ${esc(requester?.name||affected?.name||'No indicado')}<br><b>Sector:</b> ${esc(ticket.sectorInfo?.name||'No indicado')} · <b>Turno de soporte:</b> ${esc(shift)}<br><b>Equipo:</b> ${esc(device?`${device.model} (${device.type})`:'No corresponde')} · <b>Categoría:</b> ${esc(ticket.category||'General')}<br><b>Creado:</b> ${esc(formatDateTime(ticket.createdAt))}</div></div>`;if(!isStaff()){ $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>Solicitud ${esc(ticket.code)}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${context}</div><div class="modal-actions"><button class="btn btn-primary" type="button" data-close>Cerrar</button></div></div></section></div>`;$('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;return;}const technicians=store.technicians.map(x=>[x.id,x.name]);modal(`Gestionar ${ticket.code}`,context+select('status','Estado',['Nuevo','Abierto','En proceso','Esperando usuario','Esperando proveedor','Resuelto','Cerrado','Cancelado'])+select('priority','Prioridad',['Baja','Media','Alta','Crítica'])+select('technician','Asignado a',[['','Sin asignar'],...technicians])+`<div class="field form-span"><label>Solución aplicada</label><textarea name="solution">${esc(ticket.solution||'')}</textarea></div>`+textValue('time','Tiempo invertido',ticket.time||''),f=>updateTicket(ticket,f));const form=$('#entry-form');form.elements.status.value=ticket.status;form.elements.priority.value=ticket.priority;form.elements.technician.value=ticket.technicianId||'';}
async function updateTicket(ticket, values){const payload={status:values.get('status'),priority:values.get('priority'),technicianId:values.get('technician')||'',solution:values.get('solution')||'',timeSpent:values.get('time')||''};const {ticket:updated}=await api(`/tickets/${ticket.id}`,{method:'PATCH',body:payload});const normalized=normalizeTicket(updated);const idx=store.tickets.findIndex(t=>t.id===ticket.id);if(idx>=0)store.tickets[idx]=normalized;}

/* ---------- Menu rapido de tickets (cerrar/resolver/asignarme sin abrir el detalle) ---------- */
function openQuickMenu(button, ticketId){
  const rect=button.getBoundingClientRect();
  const root=$('#modal-root');
  const left=Math.min(rect.left,window.innerWidth-200);
  root.innerHTML=`<div class="quick-menu-backdrop" id="quick-menu-backdrop"></div><div class="quick-menu" style="top:${rect.bottom+6}px;left:${left}px"><button type="button" data-quick-action="resolve">✓ Marcar como Resuelto</button><button type="button" data-quick-action="close">✕ Cerrar ticket</button><button type="button" data-quick-action="assign">◈ Asignarme</button></div>`;
  $('#quick-menu-backdrop').onclick=closeModal;
  root.querySelectorAll('[data-quick-action]').forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.quickAction;
    const payload=action==='resolve'?{status:'Resuelto'}:action==='close'?{status:'Cerrado'}:{technicianId:currentUser.id};
    closeModal();
    try{
      const {ticket:updated}=await api(`/tickets/${ticketId}`,{method:'PATCH',body:payload});
      const idx=store.tickets.findIndex(t=>t.id===ticketId);
      if(idx>=0)store.tickets[idx]=normalizeTicket(updated);
      toast('Ticket actualizado.');
      render();
    }catch(err){toast(apiErrorMessage(err));}
  });
}

let searchDebounce;
function globalSearch(query){clearTimeout(searchDebounce);const q=query.trim();const root=$('#modal-root');if(!q){root.innerHTML='';return;}searchDebounce=setTimeout(()=>runGlobalSearch(q),250);}
async function runGlobalSearch(q){const root=$('#modal-root');try{const [peopleRes,equipRes,ticketsRes]=await Promise.all([api(`/employees?q=${encodeURIComponent(q)}`),api(`/equipment?q=${encodeURIComponent(q)}`),api(`/tickets?q=${encodeURIComponent(q)}`)]);const people=peopleRes.employees.map(normalizeEmployee);const equips=equipRes.equipment.map(normalizeEquipment);const tickets=ticketsRes.tickets.map(normalizeTicket);root.innerHTML=`<div class="modal-backdrop" style="align-items:start;padding-top:78px" id="search-overlay"><div class="modal"><div class="modal-body" style="padding-top:18px"><div class="result-group"><h3>Personas (${people.length})</h3>${people.map(x=>`<div class="result" data-employee="${x.id}"><div class="result-icon">♙</div><div><strong>${esc(x.name)}</strong><span>${esc(x.sectorName)} · int. ${esc(x.extension)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Equipamiento (${equips.length})</h3>${equips.map(x=>`<div class="result" data-equipment="${x.id}"><div class="result-icon">▣</div><div><strong>${esc(x.model)||esc(x.type)}</strong><span>${esc(x.type)} · ${esc(x.sectorName||'Sin sector')}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Tickets (${tickets.length})</h3>${tickets.map(x=>`<div class="result" data-ticket="${x.id}"><div class="result-icon">◈</div><div><strong>${esc(x.code)} · ${esc(x.title)}</strong><span>${esc(x.status)} · ${esc(x.technician)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div></div></div></div>`;wireRecords(root);}catch{ /* si la busqueda falla, se deja el overlay como estaba */ }}
function closeModal(){const root=$('#modal-root');if(root)root.innerHTML='';}
function modal(title,fields,onSubmit){$('#modal-root').innerHTML=`<div class="modal-backdrop"><form class="modal" id="entry-form"><div class="modal-head"><h2>${title}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${fields}</div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></div></form></div>`;$('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;const form=$('#entry-form');form.onsubmit=async e=>{e.preventDefault();const submitBtn=form.querySelector('button[type=submit]');const values=new FormData(form);submitBtn.disabled=true;try{await onSubmit(values);closeModal();toast('Registro guardado correctamente.');render();}catch(err){toast(apiErrorMessage(err));submitBtn.disabled=false;}};}
const field=(name,label,type='text',extra='')=>`<div class="field ${extra}"><label>${label}</label>${type==='textarea'?`<textarea name="${name}"></textarea>`:`<input name="${name}" type="${type}" required />`}</div>`;
const requiredTextArea=(name,label,extra='')=>`<div class="field ${extra}"><label>${label}</label><textarea name="${name}" required></textarea></div>`;
const textValue=(name,label,value='',extra='')=>`<div class="field ${extra}"><label>${label}</label><input name="${name}" value="${esc(value)}" required /></div>`;

/* ---------- Sector: desplegable compartido (se crea/administra desde su propia pantalla) ---------- */
function sectorSelectOptions(selectedId){
  const opts=[['','Sin definir'],...store.sectors.map(s=>[s.id,s.name])];
  return opts.map(([v,l])=>`<option value="${esc(v)}"${v===selectedId?' selected':''}>${esc(l)}</option>`).join('');
}
const sectorField=(selectedId='',label='Sector')=>`<div class="field"><label>${label}</label><select name="sectorId">${sectorSelectOptions(selectedId)}</select></div>`;

function ticketFields(personId='', isRequestFromEmployee=false){const person=employee(personId);const equipmentOptions=[['','No corresponde'],...store.equipment.map(x=>[x.id,`${x.model||x.type} · ${x.type}`])];const peopleOptions=store.employees.map(x=>[x.id,`${x.name} · ${x.sectorName}`]);const scheduleOptions=[['','No indicado'],...store.schedules.map(s=>[s.id,`${s.name} · ${s.startTime}–${s.endTime}`])];const shared=select('equipment','Equipo relacionado',equipmentOptions)+sectorField(person?.sectorId||'')+select('category','Categoría',['Acceso / contraseña','Aplicación / sistema','Hardware','Impresión','Red / conectividad','Telefonía','Otro'])+select('priority','Prioridad',['Media','Baja','Alta','Crítica'])+select('scheduleId','Turno de soporte',scheduleOptions)+requiredTextArea('description','Descripción del inconveniente','form-span');return (isRequestFromEmployee?'':select('employee','Persona a asistir',peopleOptions)+select('requestedBy','Solicitud informada por',peopleOptions))+field('title','Título breve','text','form-span')+shared;}
async function createTicket(values){const payload={title:values.get('title'),description:values.get('description'),equipmentId:values.get('equipment')||'',sectorId:values.get('sectorId')||'',scheduleId:values.get('scheduleId')||'',category:values.get('category'),priority:values.get('priority')};if(values.has('employee'))payload.employeeId=values.get('employee');if(values.has('requestedBy'))payload.requestedById=values.get('requestedBy')||'';const {ticket}=await api('/tickets',{method:'POST',body:payload});store.tickets.unshift(normalizeTicket(ticket));}
function openNew(kind){
 if(kind==='ticket')modal('Nuevo ticket',ticketFields('',false),f=>createTicket(f));
 if(kind==='employee-ticket')modal('Solicitar soporte',ticketFields(currentUser.employeeId,true),f=>createTicket(f));
 if(kind==='employee')modal('Nueva persona',field('name','Nombre y apellido')+field('email','Correo','email')+sectorField()+field('position','Cargo')+field('extension','Interno')+field('phone','Teléfono')+select('workShift','Turno laboral',['Mañana','Tarde','Jornada completa','Otro'])+field('schedule','Horario habitual')+select('replacement','Reemplazo habitual',[['','No definido'],...store.employees.map(x=>[x.id,x.name])])+field('notes','Observaciones','textarea','form-span'),async f=>{const payload={name:f.get('name'),email:f.get('email')||undefined,sectorId:f.get('sectorId')||'',position:f.get('position')||undefined,extension:f.get('extension')||undefined,phone:f.get('phone')||undefined,workShift:f.get('workShift')||undefined,schedule:f.get('schedule')||undefined,replacementId:f.get('replacement')||'',notes:f.get('notes')||undefined};const {employee:created}=await api('/employees',{method:'POST',body:payload});store.employees.push(normalizeEmployee(created));});
 if(kind==='equipment')modal('Nuevo equipo',select('type','Tipo',['PC','Notebook','Monitor','Teclado','Mouse','Scanner','Impresora','UPS','Teléfono IP','Lector','Otro'])+field('model','Modelo / nombre')+sectorField()+field('notes','Observaciones','textarea','form-span'),async f=>{const payload={type:f.get('type'),model:f.get('model'),sectorId:f.get('sectorId')||'',notes:f.get('notes')||undefined};const {equipment:created}=await api('/equipment',{method:'POST',body:payload});store.equipment.push(normalizeEquipment(created));});
 if(kind==='log')modal('Registrar evento',field('title','Título','text','form-span')+select('category','Categoría',['Mantenimiento','Infraestructura','Seguridad','Cambio','Actualización'])+field('detail','Detalle técnico','textarea','form-span'),async f=>{const payload={title:f.get('title'),category:f.get('category'),detail:f.get('detail')};const {entry}=await api('/logbook',{method:'POST',body:payload});store.logbook.unshift(normalizeLogbookEntry(entry));});
 if(kind==='user')modal('Crear usuario',field('name','Nombre completo')+field('username','Usuario')+field('password','Contraseña inicial','password')+select('role','Rol',['Administrador','Supervisor','User'])+select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name])]),async f=>{const payload={name:f.get('name'),username:f.get('username'),password:f.get('password'),role:f.get('role'),employeeId:f.get('role')==='User'?(f.get('employee')||''):''};const {user:created}=await api('/users',{method:'POST',body:payload});store.users.push(normalizeUser(created));});
 if(kind==='sector')modal('Nuevo sector',field('name','Nombre del sector'),async f=>{const {sector:created}=await api('/sectors',{method:'POST',body:{name:f.get('name')}});store.sectors.push(normalizeSector(created));});
 if(kind==='schedule')modal('Nuevo turno',field('name','Nombre del turno')+textValue('startTime','Inicio (HH:MM)','')+textValue('endTime','Fin (HH:MM)',''),async f=>{const {schedule:created}=await api('/schedules',{method:'POST',body:{name:f.get('name'),startTime:f.get('startTime'),endTime:f.get('endTime')}});store.schedules.push(normalizeSchedule(created));});
}

/* ---------- Panel administrador: editar/eliminar usuarios ---------- */
function openUserEdit(id){
  const u=store.users.find(x=>x.id===id);
  if(!u)return;
  const isSelf=currentUser.id===id;
  const fields=textValue('name','Nombre completo',u.name)
    +select('role','Rol',['Administrador','Supervisor','User'])
    +select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name])])
    +select('status','Estado',['Activo','Inactivo'])
    +`<div class="field form-span"><label>Nueva contraseña (opcional)</label><input name="password" type="password" placeholder="Dejar en blanco para no cambiarla" autocomplete="new-password" /></div>`;
  modal(`Editar ${u.name}`,fields,f=>updateUser(u,f));
  const form=$('#entry-form');
  form.elements.role.value=u.role;
  form.elements.employee.value=u.employeeId||'';
  form.elements.status.value=u.status;
  if(!isSelf){
    const deleteBtn=document.createElement('button');
    deleteBtn.type='button';
    deleteBtn.className='btn btn-danger';
    deleteBtn.textContent='Eliminar usuario';
    deleteBtn.onclick=()=>removeUser(u);
    $('.modal-actions').prepend(deleteBtn);
  }
}
async function updateUser(u,values){
  const password=values.get('password');
  const payload={name:values.get('name'),role:values.get('role'),employeeId:values.get('employee')||'',status:values.get('status')};
  if(password)payload.password=password;
  const {user:updated}=await api(`/users/${u.id}`,{method:'PATCH',body:payload});
  const idx=store.users.findIndex(x=>x.id===u.id);
  if(idx>=0)store.users[idx]=normalizeUser(updated);
}
async function removeUser(u){
  if(!window.confirm(`¿Eliminar definitivamente a ${u.name}? Esta acción no se puede deshacer.`))return;
  try{
    await api(`/users/${u.id}`,{method:'DELETE'});
    closeModal();
    toast('Usuario eliminado.');
    render();
  }catch(err){toast(apiErrorMessage(err));}
}

/* ---------- Sectores y Horarios: editar/eliminar ---------- */
function openSectorEdit(id){
  const s=store.sectors.find(x=>x.id===id);
  if(!s)return;
  const fields=textValue('name','Nombre',s.name)+select('status','Estado',['Activo','Inactivo']);
  modal('Editar sector',fields,f=>updateSector(s,f));
  $('#entry-form').elements.status.value=s.status;
  if(isAdmin()){
    const deleteBtn=document.createElement('button');
    deleteBtn.type='button';deleteBtn.className='btn btn-danger';deleteBtn.textContent='Eliminar sector';
    deleteBtn.onclick=()=>removeSector(s);
    $('.modal-actions').prepend(deleteBtn);
  }
}
async function updateSector(s,values){
  const {sector:updated}=await api(`/sectors/${s.id}`,{method:'PATCH',body:{name:values.get('name'),status:values.get('status')}});
  const idx=store.sectors.findIndex(x=>x.id===s.id);
  if(idx>=0)store.sectors[idx]=normalizeSector(updated);
}
async function removeSector(s){
  if(!window.confirm(`¿Eliminar el sector "${s.name}"? Las personas y equipos que lo tenían asignado quedarán sin sector.`))return;
  try{
    await api(`/sectors/${s.id}`,{method:'DELETE'});
    closeModal();
    toast('Sector eliminado.');
    currentView='sectors';
    render();
  }catch(err){toast(apiErrorMessage(err));}
}
function openScheduleEdit(id){
  const s=store.schedules.find(x=>x.id===id);
  if(!s)return;
  const fields=textValue('name','Nombre del turno',s.name)+textValue('startTime','Inicio (HH:MM)',s.startTime)+textValue('endTime','Fin (HH:MM)',s.endTime)+select('status','Estado',['Activo','Inactivo']);
  modal('Editar turno',fields,f=>updateSchedule(s,f));
  $('#entry-form').elements.status.value=s.status;
  if(isAdmin()){
    const deleteBtn=document.createElement('button');
    deleteBtn.type='button';deleteBtn.className='btn btn-danger';deleteBtn.textContent='Eliminar turno';
    deleteBtn.onclick=()=>removeSchedule(s);
    $('.modal-actions').prepend(deleteBtn);
  }
}
async function updateSchedule(s,values){
  const {schedule:updated}=await api(`/schedules/${s.id}`,{method:'PATCH',body:{name:values.get('name'),startTime:values.get('startTime'),endTime:values.get('endTime'),status:values.get('status')}});
  const idx=store.schedules.findIndex(x=>x.id===s.id);
  if(idx>=0)store.schedules[idx]=normalizeSchedule(updated);
}
async function removeSchedule(s){
  if(!window.confirm(`¿Eliminar el turno "${s.name}"?`))return;
  try{
    await api(`/schedules/${s.id}`,{method:'DELETE'});
    closeModal();
    toast('Turno eliminado.');
    render();
  }catch(err){toast(apiErrorMessage(err));}
}

function select(name,label,items){return `<div class="field"><label>${label}</label><select name="${name}">${items.map(x=>Array.isArray(x)?`<option value="${esc(x[0])}">${esc(x[1])}</option>`:`<option>${esc(x)}</option>`).join('')}</select></div>`}
function toast(message){const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),3000);}
function wireRecords(root=document){root.querySelectorAll('[data-employee]').forEach(x=>x.onclick=()=>{currentView='employee-detail';render(x.dataset.employee);});root.querySelectorAll('[data-equipment]').forEach(x=>x.onclick=()=>{currentView='equipment-detail';render(x.dataset.equipment);});root.querySelectorAll('[data-ticket]').forEach(x=>x.onclick=()=>{const ticket=store.tickets.find(y=>y.id===x.dataset.ticket);if(ticket)ticketDetail(ticket);});root.querySelectorAll('[data-user]').forEach(x=>x.onclick=()=>openUserEdit(x.dataset.user));root.querySelectorAll('[data-quick-menu]').forEach(x=>x.onclick=e=>{e.stopPropagation();openQuickMenu(x,x.dataset.quickMenu);});root.querySelectorAll('[data-sector]').forEach(x=>x.onclick=()=>{currentView='sector-detail';render(x.dataset.sector);});root.querySelectorAll('[data-schedule]').forEach(x=>x.onclick=()=>openScheduleEdit(x.dataset.schedule));root.querySelectorAll('[data-edit-sector]').forEach(x=>x.onclick=()=>openSectorEdit(x.dataset.editSector));}
function wirePage(){document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>openNew(x.dataset.action.replace('new-','')));document.querySelectorAll('.filter').forEach(input=>input.oninput=()=>{const q=input.value.toLowerCase();const kind=input.dataset.filter;const rows=store[kind].filter(x=>Object.values(x).join(' ').toLowerCase().includes(q));$(`#${kind}-table`).innerHTML=kind==='tickets'?ticketsTable(rows):kind==='employees'?employeesTable(rows):equipmentTable(rows);wireRecords($(`#${kind}-table`));});wireRecords();}

/* ---------- Chat interno (1 a 1) ---------- */
function chatConvRowHtml(c){
  const previewText=c.lastMessage?(c.lastMessage.mine?'Vos: ':'')+c.lastMessage.body:'Sin mensajes todavía.';
  const badge=c.unreadCount>0?`<span class="chat-conv-badge">${c.unreadCount>99?'99+':c.unreadCount}</span>`:'';
  return `<div class="chat-conv ${c.id===activeChatConversationId?'active':''}" data-conversation="${c.id}"><div class="chat-conv-row"><strong>${esc(c.otherUser.name)}</strong>${badge}</div><div class="chat-conv-preview">${esc(previewText)}</div></div>`;
}
async function chatView(){
  const {conversations}=await api('/chat/conversations');
  chatConversations=conversations;
  const list=chatConversations.length?chatConversations.map(chatConvRowHtml).join(''):'<div class="empty">Todavía no tenés conversaciones.</div>';
  return page('Mensajes','Chat interno entre usuarios de la plataforma, sin salir de CIGST.',`<button class="btn btn-primary" type="button" data-chat-new>+ Nueva conversación</button>`)
    +`<div class="chat-layout"><div class="panel chat-list">${list}</div><div class="panel chat-thread" id="chat-thread"><div class="empty">Elegí una conversación para ver los mensajes.</div></div></div>`;
}
function wireChatView(){
  document.querySelectorAll('[data-conversation]').forEach(el=>el.onclick=()=>openChatThread(el.dataset.conversation));
  const newBtn=document.querySelector('[data-chat-new]');
  if(newBtn)newBtn.onclick=openNewChatPicker;
  if(activeChatConversationId&&chatConversations.some(c=>c.id===activeChatConversationId)){
    openChatThread(activeChatConversationId);
  }
}
async function openNewChatPicker(){
  let users;
  try{({users}=await api('/chat/directory'));}catch(err){toast(apiErrorMessage(err));return;}
  const root=$('#modal-root');
  const rows=users.map(u=>`<div class="result" data-pick-user="${u.id}"><div class="result-icon">◉</div><div><strong>${esc(u.name)}</strong><span>${esc(u.role)}</span></div></div>`).join('')||'<div class="empty">No hay otros usuarios activos.</div>';
  root.innerHTML=`<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>Nueva conversación</h2><button class="close" type="button">×</button></div><div class="modal-body">${rows}</div></section></div>`;
  $('.close').onclick=closeModal;
  root.querySelectorAll('[data-pick-user]').forEach(el=>el.onclick=()=>{
    const recipientId=el.dataset.pickUser;
    const recipient=users.find(u=>u.id===recipientId);
    closeModal();
    const existing=chatConversations.find(c=>c.otherUser.id===recipientId);
    if(existing){openChatThread(existing.id);return;}
    openNewThreadComposer(recipientId,recipient?.name||'Usuario');
  });
}
function chatBubble(m){
  return `<div class="chat-bubble ${m.mine?'mine':''}"><div class="chat-bubble-text">${esc(m.body)}</div><div class="chat-bubble-time">${formatDateTime(m.createdAt)}</div></div>`;
}
function renderChatMessagesInner(hasMore){
  return (hasMore?'<button type="button" class="btn btn-ghost chat-load-more" id="chat-load-more">Cargar mensajes anteriores</button>':'')+chatMessages.map(chatBubble).join('');
}
function renderChatThreadShell(otherName,hasMore){
  return `<div class="chat-thread-head"><strong>${esc(otherName)}</strong></div>`
    +`<div class="chat-messages" id="chat-messages">${renderChatMessagesInner(hasMore)}</div>`
    +`<form class="chat-composer" id="chat-composer"><textarea name="body" maxlength="2000" placeholder="Escribí un mensaje… (Enter para enviar, Shift+Enter para saltear línea)" required></textarea><button class="btn btn-primary" type="submit">Enviar</button></form>`;
}
function scrollChatToBottom(){
  const container=document.getElementById('chat-messages');
  if(container)container.scrollTop=container.scrollHeight;
}
function appendChatMessage(m){
  chatMessages.push(m);
  const container=document.getElementById('chat-messages');
  if(container){container.insertAdjacentHTML('beforeend',chatBubble(m));scrollChatToBottom();}
}
async function openChatThread(conversationId){
  activeChatConversationId=conversationId;
  stopChatThreadPolling();
  document.querySelectorAll('[data-conversation]').forEach(el=>el.classList.toggle('active',el.dataset.conversation===conversationId));
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML='<div class="empty">Cargando…</div>';
  const conv=chatConversations.find(c=>c.id===conversationId);
  let messages,hasMore;
  try{({messages,hasMore}=await api(`/chat/conversations/${conversationId}/messages`));}
  catch(err){toast(apiErrorMessage(err));pane.innerHTML='<div class="empty">No se pudo cargar la conversación.</div>';return;}
  chatMessages=messages;
  pane.innerHTML=renderChatThreadShell(conv?.otherUser?.name||'Conversación',hasMore);
  scrollChatToBottom();
  wireChatComposer({conversationId});
  wireChatLoadMore(conversationId,hasMore);
  try{await api(`/chat/conversations/${conversationId}/read`,{method:'POST'});}catch{ /* si falla, se reintenta en el proximo poll */ }
  if(conv)conv.unreadCount=0;
  refreshChatUnreadBadge();
  startChatThreadPolling(conversationId);
}
function openNewThreadComposer(recipientId,recipientName){
  activeChatConversationId=null;
  chatMessages=[];
  stopChatThreadPolling();
  document.querySelectorAll('[data-conversation]').forEach(el=>el.classList.remove('active'));
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML=renderChatThreadShell(recipientName,false);
  wireChatComposer({pendingRecipientId:recipientId});
}
function wireChatLoadMore(conversationId,hasMore){
  const btn=document.getElementById('chat-load-more');
  if(!btn)return;
  if(!hasMore){btn.remove();return;}
  btn.onclick=async()=>{
    const oldestId=chatMessages[0]?.id;
    if(!oldestId)return;
    btn.disabled=true;
    try{
      const {messages,hasMore:more}=await api(`/chat/conversations/${conversationId}/messages?before=${oldestId}`);
      const container=document.getElementById('chat-messages');
      const prevScrollHeight=container.scrollHeight;
      chatMessages=[...messages,...chatMessages];
      container.innerHTML=renderChatMessagesInner(more);
      wireChatLoadMore(conversationId,more);
      container.scrollTop=container.scrollHeight-prevScrollHeight;
    }catch(err){toast(apiErrorMessage(err));btn.disabled=false;}
  };
}
function wireChatComposer(target){
  const form=document.getElementById('chat-composer');
  if(!form)return;
  const textarea=form.querySelector('textarea[name=body]');
  form.onsubmit=async e=>{
    e.preventDefault();
    const body=textarea.value.trim();
    if(!body)return;
    const submitBtn=form.querySelector('button[type=submit]');
    submitBtn.disabled=true;
    try{
      if(target.conversationId){
        const {message}=await api(`/chat/conversations/${target.conversationId}/messages`,{method:'POST',body:{body}});
        appendChatMessage(message);
      }else{
        const {conversation,message}=await api('/chat/conversations',{method:'POST',body:{recipientId:target.pendingRecipientId,body}});
        activeChatConversationId=conversation.id;
        // Reasigna el target capturado por este mismo closure: el segundo
        // mensaje en adelante ya usa el conversationId real, sin re-wirear el form.
        target={conversationId:conversation.id};
        appendChatMessage(message);
        startChatThreadPolling(conversation.id);
        refreshChatConversationList();
      }
      textarea.value='';
    }catch(err){toast(apiErrorMessage(err));}
    finally{submitBtn.disabled=false;}
  };
  textarea.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}
  });
}
async function refreshChatConversationList(){
  try{
    const {conversations}=await api('/chat/conversations');
    chatConversations=conversations;
    const listEl=document.querySelector('.chat-list');
    if(listEl){
      listEl.innerHTML=chatConversations.length?chatConversations.map(chatConvRowHtml).join(''):'<div class="empty">Todavía no tenés conversaciones.</div>';
      document.querySelectorAll('[data-conversation]').forEach(el=>el.onclick=()=>openChatThread(el.dataset.conversation));
    }
  }catch{ /* silencioso: no interrumpe la conversacion abierta */ }
}
function startChatThreadPolling(conversationId){
  stopChatThreadPolling();
  chatThreadPollHandle=setInterval(async()=>{
    const lastId=chatMessages[chatMessages.length-1]?.id;
    if(!lastId)return;
    try{
      const {messages}=await api(`/chat/conversations/${conversationId}/messages?after=${lastId}`);
      if(messages.length){
        messages.forEach(appendChatMessage);
        try{await api(`/chat/conversations/${conversationId}/read`,{method:'POST'});}catch{ /* se reintenta en el proximo poll */ }
      }
    }catch{ /* un poll fallido no debe interrumpir la conversacion */ }
  },CHAT_THREAD_POLL_MS);
}
function stopChatThreadPolling(){
  if(chatThreadPollHandle){clearInterval(chatThreadPollHandle);chatThreadPollHandle=null;}
}
async function refreshChatUnreadBadge(){
  try{
    const {count}=await api('/chat/unread-count');
    chatUnreadCount=count;
    document.querySelectorAll('.nav-item[data-view="chat"]').forEach(el=>{
      const existing=el.querySelector('.nav-badge');
      if(count>0){
        const text=count>99?'99+':String(count);
        if(existing)existing.textContent=text;
        else el.insertAdjacentHTML('beforeend',`<span class="nav-badge">${text}</span>`);
      }else if(existing){existing.remove();}
    });
  }catch{ /* un poll fallido no debe molestar al usuario */ }
}
function startChatUnreadPolling(){
  stopChatUnreadPolling();
  refreshChatUnreadBadge();
  chatUnreadPollHandle=setInterval(refreshChatUnreadBadge,CHAT_UNREAD_POLL_MS);
}
function stopChatUnreadPolling(){
  if(chatUnreadPollHandle){clearInterval(chatUnreadPollHandle);chatUnreadPollHandle=null;}
}

/* ---------- Router ---------- */
async function render(id){
  if(!session){loginView();return;}
  stopChatThreadPolling();

  if(!isStaff()){
    if(currentView!=='chat')currentView='employee-portal';
    let content;
    try{
      if(currentView==='chat'){content=await chatView();}
      else{await loadEmployeeData();content=employeePortal();}
    }catch(err){handleApiError(err);return;}
    shell(content);wirePage();
    if(currentView==='chat')wireChatView();
    return;
  }
  if(currentView==='users'&&!isAdmin())currentView='dashboard';
  if(currentView==='logbook'&&!isAdmin())currentView='dashboard';
  try{
    if(currentView!=='chat')await loadStaffData();
    if(currentView==='users')await loadUsers();
  }catch(err){handleApiError(err);return;}
  let content;
  switch(currentView){
    case 'tickets':content=ticketsView();break;
    case 'employees':content=employeesView();break;
    case 'equipment':content=equipmentView();break;
    case 'sectors':content=sectorsView();break;
    case 'logbook':content=logbookView();break;
    case 'users':content=usersView();break;
    case 'chat':content=await chatView();break;
    case 'employee-detail':{
      let detail;
      try{const res=await api(`/employees/${id}`);detail=normalizeEmployee(res.employee);}
      catch(err){handleApiError(err);return;}
      content=employeeDetail(detail);
      break;
    }
    case 'equipment-detail':content=equipmentDetail(equipment(id));break;
    case 'sector-detail':{
      let detail;
      try{const res=await api(`/sectors/${id}`);detail=normalizeSector(res.sector);}
      catch(err){handleApiError(err);return;}
      content=sectorDetail(detail);
      break;
    }
    default:content=dashboard();
  }
  shell(content);wirePage();
  if(currentView==='chat')wireChatView();
}

(async function bootstrap(){
  try{const {user}=await api('/auth/me');applySessionUser(user);}
  catch{session=false;currentUser=null;}
  render();
})();
