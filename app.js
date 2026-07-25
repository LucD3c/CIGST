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
    loginView();
    toast('Tu sesión expiró. Iniciá sesión nuevamente.');
    return;
  }
  toast(apiErrorMessage(err));
}

/* ---------- Estado ---------- */
let store = { employees: [], equipment: [], tickets: [], logbook: [], users: [], technicians: [], colleagues: [], activity: [] };
let currentUser = null;
let session = false;
let currentView = 'dashboard';
const SUPPORT_SHIFTS = [{ name: 'Mañana', hours: '07:30–14:30' }, { name: 'Tarde', hours: '14:30–21:00' }];

/* ---------- Normalizadores (API -> forma que usa la interfaz) ---------- */
function normalizeEmployee(e) {
  return {
    id: e.id, code: e.code, name: e.name, document: e.document || '—', email: e.email || '',
    phone: e.phone || '', extension: e.extension || '', sector: e.sector || '', position: e.position || '',
    status: e.status, equipment: (e.equipment || []).map(x => x.id), workShift: e.workShift || '',
    schedule: e.schedule || '', replacement: e.replacementId || '', notes: e.notes || '',
  };
}
function normalizeEquipment(e) {
  return {
    id: e.id, code: e.code, type: e.type, brand: e.brand || '', model: e.model || '', serial: e.serial || '—',
    asset: e.asset || '—', status: e.status, employee: e.employeeId || '', location: e.location || '',
    warranty: e.warranty || 'No registrada', notes: e.notes || '',
  };
}
function normalizeTicket(t) {
  return {
    id: t.id, code: t.code, title: t.title, description: t.description || '',
    employee: t.employeeId, requestedBy: t.requestedById || '', replacement: t.replacementId || '',
    equipment: t.equipmentId || '', location: t.location || '', contact: t.contact || '',
    availability: t.availability || '', supportShift: t.supportShift || '', category: t.category || 'General',
    impact: t.impact || 'Individual', technician: t.technician?.name || '', technicianId: t.technicianId || '',
    status: t.status, priority: t.priority, solution: t.solution || '', time: t.timeSpent || '',
    createdAt: t.createdAt, updatedAt: t.updatedAt, createdByName: t.createdBy?.name || '',
    employeeInfo: t.employee || null, requestedByInfo: t.requestedBy || null,
    replacementInfo: t.replacement || null, equipmentInfo: t.equipment || null,
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

/* ---------- Carga de datos por sesion/vista ---------- */
function applySessionUser(user) {
  currentUser = { id: user.id, name: user.name, role: user.role, employeeId: user.employeeId || '', initials: user.name.split(' ').map(x => x[0]).slice(0, 2).join('') };
  session = true;
  const ctx = user.employee;
  if (ctx) {
    store.employees = [{ id: ctx.id, code: '', name: ctx.name, document: '—', email: '', phone: '', extension: ctx.extension || '', sector: ctx.sector || '', position: '', status: 'Activo', equipment: ctx.equipment.map(e => e.id), workShift: ctx.workShift || '', schedule: ctx.schedule || '', replacement: '', notes: '' }];
    store.equipment = ctx.equipment.map(e => ({ id: e.id, code: e.asset || '', type: '', brand: e.brand || '', model: e.model || '', serial: '—', asset: e.asset || '—', status: 'Operativo', employee: ctx.id, location: '', warranty: '', notes: '' }));
    store.colleagues = ctx.colleagues.map(c => ({ id: c.id, name: c.name, sector: c.sector || '' }));
  } else {
    store.employees = []; store.equipment = []; store.colleagues = [];
  }
  currentView = isStaff() ? 'dashboard' : 'employee-portal';
}
async function loadStaffData() {
  const [employeesRes, equipmentRes, ticketsRes, logbookRes, techniciansRes] = await Promise.all([
    api('/employees'), api('/equipment'), api('/tickets'), api('/logbook'), api('/users/technicians'),
  ]);
  store.employees = employeesRes.employees.map(normalizeEmployee);
  store.equipment = equipmentRes.equipment.map(normalizeEquipment);
  store.tickets = ticketsRes.tickets.map(normalizeTicket);
  store.logbook = logbookRes.entries.map(normalizeLogbookEntry);
  store.technicians = techniciansRes.technicians;
  store.colleagues = store.employees;
  store.activity = deriveActivity(store.tickets, store.logbook);
}
async function loadUsers() {
  const { users } = await api('/users');
  store.users = users.map(normalizeUser);
}
async function loadEmployeeTickets() {
  const { tickets } = await api('/tickets');
  store.tickets = tickets.map(normalizeTicket);
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
const statusClass = value => ({'Crítica':'b-red','Alta':'b-yellow','Nuevo':'b-blue','En proceso':'b-blue','Abierto':'b-blue','Esperando proveedor':'b-yellow','Esperando usuario':'b-yellow','Resuelto':'b-green','Cerrado':'b-green','Operativo':'b-green','En reparación':'b-yellow','Activo':'b-green','Bloqueado':'b-red','Baja':'b-gray','Media':'b-blue'}[value] || 'b-gray');
const badge = value => `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
const navItems = [ ['dashboard','⌂','Centro de operaciones'], ['tickets','◈','Tickets'], ['employees','♙','Personas'], ['equipment','▣','Equipamiento'], ['logbook','▤','Bitácora técnica'], ['users','◉','Panel administrador'] ];
const isAdmin = () => currentUser?.role === 'Administrador';
const isStaff = () => currentUser?.role !== 'Empleado';

/* ---------- Vistas ---------- */
function loginView(){app.innerHTML=`<main class="login-page"><section class="login-card"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><h1>Centro de Soporte</h1><p>Ingresá con las credenciales proporcionadas por Sistemas.</p><form id="login-form"><div class="field"><label for="username">Usuario</label><input id="username" name="username" required autocomplete="username" autofocus /></div><div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" /></div><div class="login-actions"><label class="remember"><input type="checkbox" checked /> Recordarme</label><button class="btn btn-primary" type="submit">Iniciar sesión</button></div></form></section></main>`;$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const submitBtn=e.currentTarget.querySelector('button[type=submit]');submitBtn.disabled=true;try{const {user}=await api('/auth/login',{method:'POST',body:{username:form.get('username'),password:form.get('password')}});applySessionUser(user);await render();}catch(err){toast(apiErrorMessage(err));}finally{submitBtn.disabled=false;}});}
function shell(content){const staffNav=`<div class="nav-group">Operación</div>${navItems.slice(0,2).map(nav).join('')}<div class="nav-group">Información</div>${navItems.slice(2,5).map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${navItems.slice(5).map(nav).join('')}`:''}`;app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><nav class="nav">${isStaff()?staffNav:`<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}`}</nav><div class="sidebar-user"><strong>${esc(currentUser.name)}</strong><span>${esc(currentUser.role)}</span></div></aside><main class="main"><header class="topbar">${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions"><span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{currentView=el.dataset.view;render();});$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }session=false;currentUser=null;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
const nav=([id,icon,label])=>`<button class="nav-item ${currentView===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`;
function keyHandler(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#global-search')?.focus();}if(e.key==='Escape')closeModal();}
function page(title,subtitle,button=''){return `<div class="page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`}
function dashboard(){const active=store.tickets.filter(t=>!['Resuelto','Cerrado','Cancelado'].includes(t.status));return page('Centro de operaciones','Visión general del soporte técnico.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<section class="metrics"><div class="metric"><div class="metric-label">Abiertos <span>◈</span></div><div class="metric-value">${active.length}</div><div class="metric-meta">requieren seguimiento</div></div><div class="metric urgent"><div class="metric-label">Urgentes <span>!</span></div><div class="metric-value">${store.tickets.filter(t=>t.priority==='Crítica').length}</div><div class="metric-meta">prioridad crítica</div></div><div class="metric live"><div class="metric-label">En proceso <span>↗</span></div><div class="metric-value">${store.tickets.filter(t=>t.status==='En proceso').length}</div><div class="metric-meta">con técnico asignado</div></div><div class="metric"><div class="metric-label">Esperando <span>◷</span></div><div class="metric-value">${store.tickets.filter(t=>t.status.startsWith('Esperando')).length}</div><div class="metric-meta">usuario o proveedor</div></div><div class="metric"><div class="metric-label">Resueltos <span>✓</span></div><div class="metric-value">${store.tickets.filter(t=>['Resuelto','Cerrado'].includes(t.status)).length}</div><div class="metric-meta">histórico registrado</div></div></section><section class="grid"><div class="panel"><div class="panel-head"><h2>Tickets que requieren atención</h2><a data-view="tickets">Ver todos</a></div>${ticketsTable(active)}</div><div class="panel"><div class="panel-head"><h2>Actividad reciente</h2><a data-view="logbook">Bitácora</a></div><div class="activity">${store.activity.length?store.activity.map(activity).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'}</div></div></section><section class="two-panels"><div class="panel"><div class="panel-head"><h2>Eventos importantes</h2><a data-view="logbook">Ver bitácora</a></div>${store.logbook.length?store.logbook.slice(0,3).map(e=>`<div class="event"><strong>${esc(e.title)}</strong><span>${esc(e.category)} · ${e.date} · ${esc(e.author)}</span></div>`).join(''):'<div class="empty">No hay eventos técnicos registrados.</div>'}</div><div class="panel"><div class="panel-head"><h2>Recordatorios</h2></div><div class="empty">No hay recordatorios pendientes.</div></div></section>`}
function ticketsTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ticket</th><th>Incidencia</th><th>Prioridad</th><th>Estado</th><th>Asignado</th></tr></thead><tbody>${rows.map(t=>`<tr data-ticket="${t.id}"><td class="mono">${esc(t.code)}</td><td><strong>${esc(t.title)}</strong><br><span class="muted">${esc(employee(t.employee)?.name||t.employeeInfo?.name||'Sin empleado')}</span></td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${esc(t.technician||'Sin asignar')}</td></tr>`).join('')||`<tr><td colspan="5" class="empty">No hay tickets en esta vista.</td></tr>`}</tbody></table></div>`}
const activity=a=>`<div class="activity-item"><div class="activity-symbol">${a.icon}</div><div class="activity-copy">${a.text}</div><div class="activity-time">${a.time}</div></div>`;
function ticketsView(){return page('Tickets','Registro y seguimiento de incidencias.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, técnico o número…" data-filter="tickets" /></div><div class="panel" id="tickets-table">${ticketsTable(store.tickets)}</div>`}
function employeePortal(){const person=employee(currentUser.employeeId);const mine=store.tickets.filter(t=>t.employee===currentUser.employeeId);return page('Solicitudes de soporte','Creá una solicitud para el Departamento de Sistemas.',`<button class="btn btn-primary" data-action="new-employee-ticket">+ Solicitar soporte</button>`)+`<section class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><span class="muted">${esc(person?.sector||'')}</span></div>${ticketsTable(mine)}</section><section class="panel" style="margin-top:18px"><div class="side-card"><h3>¿Necesitás ayuda?</h3><p class="muted">Describí el problema y, si corresponde, seleccioná el equipo que estás utilizando. Sistemas recibirá tu solicitud y actualizará el estado.</p></div></section>`}
function employeesView(){return page('Personas','Ficha centralizada de colaboradores y su contexto técnico.',`<button class="btn btn-primary" data-action="new-employee">+ Nueva persona</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, correo, interno o sector…" data-filter="employees" /></div><div class="panel" id="employees-table">${employeesTable(store.employees)}</div>`}
function employeesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Persona</th><th>Sector / Cargo</th><th>Horario</th><th>Equipos</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-employee="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.sector)}<br><span class="muted">${esc(x.position)}</span></td><td>${esc(x.workShift)}<br><span class="muted">${esc(x.schedule)}</span></td><td>${x.equipment.length} asignado${x.equipment.length===1?'':'s'}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="5" class="empty">No se encontraron personas.</td></tr>`}</tbody></table></div>`}
function equipmentView(){return page('Equipamiento asignado','Activos vinculados a sus responsables e historial técnico.',`<button class="btn btn-primary" data-action="new-equipment">+ Nuevo equipo</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por activo, serie, modelo o responsable…" data-filter="equipment" /></div><div class="panel" id="equipment-table">${equipmentTable(store.equipment)}</div>`}
function equipmentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Activo</th><th>Equipo</th><th>Serie</th><th>Asignado a</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-equipment="${x.id}"><td class="mono">${esc(x.asset)}</td><td><strong>${esc(x.brand)} ${esc(x.model)}</strong><br><span class="muted">${esc(x.type)} · ${esc(x.code)}</span></td><td class="mono">${esc(x.serial)}</td><td>${esc(employee(x.employee)?.name||'Sin asignar')}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="5" class="empty">No se encontraron equipos.</td></tr>`}</tbody></table></div>`}
function logbookView(){return page('Bitácora técnica','Eventos relevantes y cambios de infraestructura.',`<button class="btn btn-primary" data-action="new-log">+ Registrar evento</button>`)+`<section class="panel">${store.logbook.map(x=>`<div class="event"><div class="row-between"><strong>${esc(x.title)}</strong>${badge(x.category)}</div><span>${x.date} · ${esc(x.author)}</span><p class="muted">${esc(x.detail)}</p></div>`).join('')}</section>`}
function usersView(){return page('Panel administrador','Usuarios, roles y accesos de la plataforma.',`<button class="btn btn-primary" data-action="new-user">+ Crear usuario</button>`)+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Ingresos</th></tr></thead><tbody>${store.users.map(x=>`<tr><td><strong>${esc(x.name)}</strong><br><span class="mono">${esc(x.username)}</span></td><td>${esc(x.role)}</td><td>${badge(x.status)}</td><td>${esc(x.lastAccess)}</td><td>${x.logins}</td></tr>`).join('')}</tbody></table></div></section>`}
function employeeDetail(x){const relatedTickets=store.tickets.filter(t=>t.employee===x.id);const replacement=employee(x.replacement);return page('Ficha de persona','Contexto operativo unificado.')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.name)}</h2><p>${esc(x.position)} · ${esc(x.sector)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Correo</label>${esc(x.email)}</div><div class="info"><label>Interno</label>${esc(x.extension)}</div><div class="info"><label>Horario</label>${esc(x.workShift)} · ${esc(x.schedule)}</div><div class="info"><label>Reemplazo</label>${esc(replacement?.name||'No definido')}</div></div></div><div class="panel-head"><h2>Tickets relacionados</h2></div>${ticketsTable(relatedTickets)}</section><aside><div class="panel side-card"><h3>Equipamiento asignado</h3>${x.equipment.map(id=>{const e=equipment(id);return e?`<div class="event"><strong>${esc(e.brand)} ${esc(e.model)}</strong><span>${esc(e.asset)} · ${badge(e.status)}</span></div>`:''}).join('')||'<p class="muted">No hay equipamiento asignado.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Notas técnicas</h3>${x.notes?`<div class="note">${esc(x.notes)}</div>`:'<p class="muted">Sin observaciones registradas.</p>'}</div></aside></div>`}
function equipmentDetail(x){const owner=employee(x.employee);const tickets=store.tickets.filter(t=>t.equipment===x.id);return page('Detalle de equipamiento','Información técnica, asignación e historial.')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.brand)} ${esc(x.model)}</h2><p>${esc(x.type)} · ${esc(x.asset)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Número de serie</label><span class="mono">${esc(x.serial)}</span></div><div class="info"><label>Ubicación</label>${esc(x.location)}</div><div class="info"><label>Garantía</label>${esc(x.warranty)}</div><div class="info"><label>Responsable</label>${esc(owner?.name||'Sin asignar')}</div></div></div><div class="panel-head"><h2>Tickets asociados</h2></div>${ticketsTable(tickets)}</section><aside><div class="panel side-card"><h3>Observaciones</h3><div class="note">${esc(x.notes||'Sin observaciones registradas.')}</div></div></aside></div>`}
function ticketDetail(ticket){const affected=ticket.employeeInfo||employee(ticket.employee);const requester=ticket.requestedByInfo||affected;const replacement=ticket.replacementInfo;const device=ticket.equipmentInfo;const context=`<div class="form-span"><div class="note"><strong>${esc(ticket.code)} · ${esc(ticket.title)}</strong><br>${esc(ticket.description||'Sin descripción adicional.')}<br><br><b>Persona a asistir:</b> ${esc(affected?.name||'No indicada')} · <b>Solicitó:</b> ${esc(requester?.name||affected?.name||'No indicado')}<br><b>Horario:</b> ${esc(ticket.availability||'No indicado')} · <b>Turno de soporte:</b> ${esc(ticket.supportShift||'No indicado')}<br><b>Reemplazo:</b> ${esc(replacement?.name||'No aplica')} · <b>Ubicación:</b> ${esc(ticket.location||'No indicada')}<br><b>Equipo:</b> ${esc(device?`${device.asset} · ${device.brand} ${device.model}`:'No corresponde')} · <b>Contacto:</b> ${esc(ticket.contact||'No indicado')}<br><b>Categoría:</b> ${esc(ticket.category||'General')} · <b>Impacto:</b> ${esc(ticket.impact||'Individual')}</div></div>`;if(!isStaff()){ $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>Solicitud ${esc(ticket.code)}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${context}</div><div class="modal-actions"><button class="btn btn-primary" type="button" data-close>Cerrar</button></div></div></section></div>`;$('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;return;}const technicians=store.technicians.map(x=>[x.id,x.name]);modal(`Gestionar ${ticket.code}`,context+select('status','Estado',['Nuevo','Abierto','En proceso','Esperando usuario','Esperando proveedor','Resuelto','Cerrado','Cancelado'])+select('priority','Prioridad',['Baja','Media','Alta','Crítica'])+select('technician','Técnico asignado',[['','Sin asignar'],...technicians])+`<div class="field form-span"><label>Solución aplicada</label><textarea name="solution">${esc(ticket.solution||'')}</textarea></div>`+textValue('time','Tiempo invertido',ticket.time||''),f=>updateTicket(ticket,f));const form=$('#entry-form');form.elements.status.value=ticket.status;form.elements.priority.value=ticket.priority;form.elements.technician.value=ticket.technicianId||'';}
async function updateTicket(ticket, values){const payload={status:values.get('status'),priority:values.get('priority'),technicianId:values.get('technician')||'',solution:values.get('solution')||'',timeSpent:values.get('time')||''};const {ticket:updated}=await api(`/tickets/${ticket.id}`,{method:'PATCH',body:payload});const normalized=normalizeTicket(updated);const idx=store.tickets.findIndex(t=>t.id===ticket.id);if(idx>=0)store.tickets[idx]=normalized;}
let searchDebounce;
function globalSearch(query){clearTimeout(searchDebounce);const q=query.trim();const root=$('#modal-root');if(!q){root.innerHTML='';return;}searchDebounce=setTimeout(()=>runGlobalSearch(q),250);}
async function runGlobalSearch(q){const root=$('#modal-root');try{const [peopleRes,equipRes,ticketsRes]=await Promise.all([api(`/employees?q=${encodeURIComponent(q)}`),api(`/equipment?q=${encodeURIComponent(q)}`),api(`/tickets?q=${encodeURIComponent(q)}`)]);const people=peopleRes.employees.map(normalizeEmployee);const equips=equipRes.equipment.map(normalizeEquipment);const tickets=ticketsRes.tickets.map(normalizeTicket);root.innerHTML=`<div class="modal-backdrop" style="align-items:start;padding-top:78px" id="search-overlay"><div class="modal"><div class="modal-body" style="padding-top:18px"><div class="result-group"><h3>Personas (${people.length})</h3>${people.map(x=>`<div class="result" data-employee="${x.id}"><div class="result-icon">♙</div><div><strong>${esc(x.name)}</strong><span>${esc(x.sector)} · int. ${esc(x.extension)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Equipamiento (${equips.length})</h3>${equips.map(x=>`<div class="result" data-equipment="${x.id}"><div class="result-icon">▣</div><div><strong>${esc(x.brand)} ${esc(x.model)}</strong><span>${esc(x.asset)} · ${esc(x.serial)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Tickets (${tickets.length})</h3>${tickets.map(x=>`<div class="result" data-ticket="${x.id}"><div class="result-icon">◈</div><div><strong>${esc(x.code)} · ${esc(x.title)}</strong><span>${esc(x.status)} · ${esc(x.technician)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div></div></div></div>`;wireRecords(root);}catch{ /* si la busqueda falla, se deja el overlay como estaba */ }}
function closeModal(){const root=$('#modal-root');if(root)root.innerHTML='';}
function modal(title,fields,onSubmit){$('#modal-root').innerHTML=`<div class="modal-backdrop"><form class="modal" id="entry-form"><div class="modal-head"><h2>${title}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${fields}</div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></div></form></div>`;$('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;const form=$('#entry-form');form.onsubmit=async e=>{e.preventDefault();const submitBtn=form.querySelector('button[type=submit]');const values=new FormData(form);submitBtn.disabled=true;try{await onSubmit(values);closeModal();toast('Registro guardado correctamente.');render();}catch(err){toast(apiErrorMessage(err));submitBtn.disabled=false;}};}
const field=(name,label,type='text',extra='')=>`<div class="field ${extra}"><label>${label}</label>${type==='textarea'?`<textarea name="${name}"></textarea>`:`<input name="${name}" type="${type}" required />`}</div>`;
const requiredTextArea=(name,label,extra='')=>`<div class="field ${extra}"><label>${label}</label><textarea name="${name}" required></textarea></div>`;
const textValue=(name,label,value='',extra='')=>`<div class="field ${extra}"><label>${label}</label><input name="${name}" value="${esc(value)}" required /></div>`;
const optionalTextValue=(name,label,value='',extra='')=>`<div class="field ${extra}"><label>${label}</label><input name="${name}" value="${esc(value)}" /></div>`;
const supportShiftOptions=()=>SUPPORT_SHIFTS.map(x=>[`${x.name} · ${x.hours}`,`${x.name} · ${x.hours}`]);
function ticketFields(personId='', isRequestFromEmployee=false){const person=employee(personId);const equipmentOptions=[['','No corresponde'],...store.equipment.map(x=>[x.id,`${x.asset} · ${x.brand} ${x.model}`])];const peopleOptions=store.employees.map(x=>[x.id,`${x.name} · ${x.sector}`]);const replacementOptions=store.colleagues.map(x=>[x.id,`${x.name}${x.sector?` · ${x.sector}`:''}`]);const shared=select('equipment','Equipo relacionado',equipmentOptions)+select('replacement','Reemplazo durante la atención',[['','No aplica'],...replacementOptions])+select('category','Categoría',['Acceso / contraseña','Aplicación / sistema','Hardware','Impresión','Red / conectividad','Telefonía','Otro'])+select('impact','Impacto',['Individual','Sector completo','Atención a pacientes'])+select('supportShift','Turno de soporte',supportShiftOptions())+textValue('location','Ubicación / sector',person?.sector||'')+textValue('availability','Horario disponible',person?.schedule||'')+select('contact','Canal de contacto',['Interno telefónico','Teléfono móvil','Correo','Presencial'])+requiredTextArea('description','Descripción del inconveniente','form-span');return (isRequestFromEmployee?'':select('employee','Persona a asistir',peopleOptions)+select('requestedBy','Solicitud informada por',peopleOptions))+field('title','Título breve','text','form-span')+shared;}
async function createTicket(values){const payload={title:values.get('title'),description:values.get('description'),equipmentId:values.get('equipment')||'',replacementId:values.get('replacement')||'',location:values.get('location')||undefined,contact:values.get('contact')||undefined,availability:values.get('availability')||undefined,supportShift:values.get('supportShift')||undefined,category:values.get('category'),impact:values.get('impact')};if(values.has('employee'))payload.employeeId=values.get('employee');if(values.has('requestedBy'))payload.requestedById=values.get('requestedBy')||'';if(values.has('priority'))payload.priority=values.get('priority');const {ticket}=await api('/tickets',{method:'POST',body:payload});store.tickets.unshift(normalizeTicket(ticket));}
function openNew(kind){
 if(kind==='ticket')modal('Nuevo ticket',ticketFields('',false)+select('priority','Prioridad',['Baja','Media','Alta','Crítica']),f=>createTicket(f));
 if(kind==='employee-ticket')modal('Solicitar soporte',ticketFields(currentUser.employeeId,true),f=>createTicket(f));
 if(kind==='employee')modal('Nueva persona',field('name','Nombre y apellido')+field('email','Correo','email')+field('sector','Sector')+field('position','Cargo')+field('extension','Interno')+field('phone','Teléfono')+select('workShift','Turno laboral',['Mañana','Tarde','Jornada completa','Otro'])+field('schedule','Horario habitual')+select('replacement','Reemplazo habitual',[['','No definido'],...store.employees.map(x=>[x.id,x.name])])+field('notes','Observaciones','textarea','form-span'),async f=>{const payload={name:f.get('name'),email:f.get('email')||undefined,sector:f.get('sector')||undefined,position:f.get('position')||undefined,extension:f.get('extension')||undefined,phone:f.get('phone')||undefined,workShift:f.get('workShift')||undefined,schedule:f.get('schedule')||undefined,replacementId:f.get('replacement')||'',notes:f.get('notes')||undefined};const {employee:created}=await api('/employees',{method:'POST',body:payload});store.employees.push(normalizeEmployee(created));});
 if(kind==='equipment')modal('Nuevo equipo',select('type','Tipo',['PC','Notebook','Monitor','Teclado','Mouse','Scanner','Impresora','UPS','Teléfono IP','Lector','Otro'])+field('brand','Fabricante')+field('model','Modelo')+field('serial','Número de serie')+field('asset','Activo fijo')+select('employee','Responsable',[['','Sin asignar'],...store.employees.map(x=>[x.id,x.name])])+field('location','Ubicación','text','form-span')+field('notes','Observaciones','textarea','form-span'),async f=>{const payload={type:f.get('type'),brand:f.get('brand')||undefined,model:f.get('model')||undefined,serial:f.get('serial')||undefined,asset:f.get('asset')||undefined,employeeId:f.get('employee')||'',location:f.get('location')||undefined,notes:f.get('notes')||undefined};const {equipment:created}=await api('/equipment',{method:'POST',body:payload});const normalized=normalizeEquipment(created);store.equipment.push(normalized);if(normalized.employee){const owner=employee(normalized.employee);if(owner)owner.equipment.push(normalized.id);}});
 if(kind==='log')modal('Registrar evento',field('title','Título','text','form-span')+select('category','Categoría',['Mantenimiento','Infraestructura','Seguridad','Cambio','Actualización'])+field('detail','Detalle técnico','textarea','form-span'),async f=>{const payload={title:f.get('title'),category:f.get('category'),detail:f.get('detail')};const {entry}=await api('/logbook',{method:'POST',body:payload});store.logbook.unshift(normalizeLogbookEntry(entry));});
 if(kind==='user')modal('Crear usuario',field('name','Nombre completo')+field('username','Usuario')+field('password','Contraseña inicial','password')+select('role','Rol',['Administrador','Técnico','Empleado'])+select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name])]),async f=>{const payload={name:f.get('name'),username:f.get('username'),password:f.get('password'),role:f.get('role'),employeeId:f.get('role')==='Empleado'?(f.get('employee')||''):''};const {user:created}=await api('/users',{method:'POST',body:payload});store.users.push(normalizeUser(created));});
}
function select(name,label,items){return `<div class="field"><label>${label}</label><select name="${name}">${items.map(x=>Array.isArray(x)?`<option value="${esc(x[0])}">${esc(x[1])}</option>`:`<option>${esc(x)}</option>`).join('')}</select></div>`}
function toast(message){const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),3000);}
function wireRecords(root=document){root.querySelectorAll('[data-employee]').forEach(x=>x.onclick=()=>{currentView='employee-detail';render(x.dataset.employee);});root.querySelectorAll('[data-equipment]').forEach(x=>x.onclick=()=>{currentView='equipment-detail';render(x.dataset.equipment);});root.querySelectorAll('[data-ticket]').forEach(x=>x.onclick=()=>{const ticket=store.tickets.find(y=>y.id===x.dataset.ticket);if(ticket)ticketDetail(ticket);});}
function wirePage(){document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>openNew(x.dataset.action.replace('new-','')));document.querySelectorAll('.filter').forEach(input=>input.oninput=()=>{const q=input.value.toLowerCase();const kind=input.dataset.filter;const rows=store[kind].filter(x=>Object.values(x).join(' ').toLowerCase().includes(q));$(`#${kind}-table`).innerHTML=kind==='tickets'?ticketsTable(rows):kind==='employees'?employeesTable(rows):equipmentTable(rows);wireRecords($(`#${kind}-table`));});wireRecords();}

/* ---------- Router ---------- */
async function render(id){
  if(!session){loginView();return;}
  if(!isStaff()){
    currentView='employee-portal';
    try{await loadEmployeeTickets();}catch(err){handleApiError(err);return;}
    shell(employeePortal());wirePage();return;
  }
  if(currentView==='users'&&!isAdmin())currentView='dashboard';
  try{
    await loadStaffData();
    if(currentView==='users')await loadUsers();
  }catch(err){handleApiError(err);return;}
  let content;
  switch(currentView){
    case 'tickets':content=ticketsView();break;
    case 'employees':content=employeesView();break;
    case 'equipment':content=equipmentView();break;
    case 'logbook':content=logbookView();break;
    case 'users':content=usersView();break;
    case 'employee-detail':content=employeeDetail(employee(id));break;
    case 'equipment-detail':content=equipmentDetail(equipment(id));break;
    default:content=dashboard();
  }
  shell(content);wirePage();
}

(async function bootstrap(){
  try{const {user}=await api('/auth/me');applySessionUser(user);}
  catch{session=false;currentUser=null;}
  render();
})();
