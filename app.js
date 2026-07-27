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
let store = { employees: [], equipment: [], tickets: [], logbook: [], users: [], technicians: [], sectors: [], schedules: [], categories: [], activity: [] };
let currentUser = null;
let session = false;
let currentView = 'dashboard';
// Vistas de detalle (persona/equipo/sector): recuerdan que registro estan
// mostrando, asi un re-render tras guardar algo no pierde el id (antes eso
// generaba un pedido a /api/xxx/undefined -> "UUID valido").
let currentDetailId = null;

/* ---------- Chat interno: estado + intervalos de polling (constantes, no numeros sueltos) ---------- */
const CHAT_THREAD_POLL_MS = 4000;
const CHAT_UNREAD_POLL_MS = 15000;
let chatConversations = [];
let chatGroups = [];
let activeChatConversationId = null;
let activeChatGroupId = null;
let chatMessages = [];
let chatUnreadCount = 0;
let chatThreadPollHandle = null;
let chatUnreadPollHandle = null;

/* ---------- Notificaciones (campanita) ---------- */
let notifUnreadCount = 0;

/* ---------- Normalizadores (API -> forma que usa la interfaz) ---------- */
function normalizeEmployee(e) {
  return {
    id: e.id, code: e.code, name: e.name, document: e.document || '—', email: e.email || '',
    phone: e.phone || '', extension: e.extension || '', sectorId: e.sectorId || '', sectorName: e.sector?.name || '',
    position: e.position || '', status: e.status, workShift: e.workShift || '', schedule: e.schedule || '',
    replacement: e.replacementId || '', replacementInfo: e.replacement || null, notes: e.notes || '',
    changeLog: e.changeLog || '',
    sectorEquipment: (e.sectorEquipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
  };
}
function normalizeEquipment(e) {
  return {
    id: e.id, code: e.code, type: e.type, model: e.model || '', status: e.status,
    sectorId: e.sectorId || '', sectorName: e.sector?.name || '', changeLog: e.changeLog || '',
  };
}
function normalizeTicket(t) {
  return {
    id: t.id, code: t.code, title: t.title, description: t.description || '',
    employee: t.employeeId, requestedBy: t.requestedById || '',
    equipment: t.equipmentId || '', sectorId: t.sectorId || '', sectorName: t.sector?.name || '',
    scheduleId: t.scheduleId || '', scheduleInfo: t.schedule || null, category: t.category || 'General',
    technician: t.technician?.name || '', technicianId: t.technicianId || '',
    status: t.status, priority: t.priority, solution: t.solution || '',
    attachments: t.attachments || [],
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
    logins: u.loginCount, employeeId: u.employeeId || '', changeLog: u.changeLog || '',
  };
}
function normalizeSector(s) {
  return {
    id: s.id, name: s.name, status: s.status,
    people: (s.people || []).map(p => ({ id: p.id, name: p.name, status: p.status })),
    equipmentList: (s.equipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
    categories: (s.categories || []).map(c => ({ id: c.id, name: c.name })),
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
  chatConversations = []; chatGroups = []; activeChatConversationId = null; activeChatGroupId = null;
  chatMessages = []; chatUnreadCount = 0; notifUnreadCount = 0; currentDetailId = null;
  startBackgroundPolling();
  currentView = isStaff() ? 'dashboard' : 'employee-portal';
}
async function loadStaffData() {
  const [employeesRes, equipmentRes, ticketsRes, techniciansRes, sectorsRes, schedulesRes, options] = await Promise.all([
    api('/employees'), api('/equipment'), api('/tickets'), api('/users/technicians'), api('/sectors'), api('/schedules'),
    api('/tickets/form-options'),
  ]);
  store.employees = employeesRes.employees.map(normalizeEmployee);
  store.equipment = equipmentRes.equipment.map(normalizeEquipment);
  store.tickets = ticketsRes.tickets.map(normalizeTicket);
  store.technicians = techniciansRes.technicians;
  store.sectors = sectorsRes.sectors.map(normalizeSector);
  store.schedules = schedulesRes.schedules.map(normalizeSchedule);
  store.categories = options.categories || [];
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
  // El rango User no puede listar /employees ni /equipment completos, pero
  // SI necesita elegir persona/equipo/sector/turno al crear un ticket:
  // /tickets/form-options le da exactamente eso (solo activos, datos minimos).
  const [ticketsRes, options] = await Promise.all([api('/tickets'), api('/tickets/form-options')]);
  store.categories = options.categories || [];
  store.tickets = ticketsRes.tickets.map(normalizeTicket);
  store.employees = options.people.map(p => ({ id: p.id, code: '', name: p.name, document: '—', email: '', phone: '', extension: '', sectorId: p.sectorId || '', sectorName: p.sectorName || '', position: '', status: 'Activo', workShift: '', schedule: '', replacement: '', replacementInfo: null, notes: '', changeLog: '', sectorEquipment: [] }));
  store.equipment = options.equipment.map(e => ({ id: e.id, code: '', type: e.type || '', model: e.model || '', status: 'Activo', sectorId: e.sectorId || '', sectorName: e.sectorName || '', changeLog: '' }));
  store.sectors = options.sectors.map(normalizeSector);
  store.schedules = options.schedules.map(normalizeSchedule);
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
  // Los nombres y codigos son clickeables: la persona lleva a su ficha y el
  // codigo de ticket abre su detalle (wireRecords ya escucha data-employee y
  // data-ticket en cualquier elemento).
  const items = [];
  tickets.forEach(t => {
    const updated = t.updatedAt && t.updatedAt !== t.createdAt;
    const personName = t.employeeInfo?.name || 'Sin persona';
    const person = t.employee ? `<strong class="linkable" data-employee="${esc(t.employee)}">${esc(personName)}</strong>` : `<strong>${esc(personName)}</strong>`;
    const codeLink = `<strong class="linkable" data-ticket="${esc(t.id)}">${esc(t.code)}</strong>`;
    items.push({
      icon: updated ? '↗' : '+',
      text: updated
        ? `${person} · ${codeLink} actualizado · ${esc(t.status)}`
        : `${person} · ${codeLink} creado por ${esc(t.createdByName || 'alguien')} · ${esc(t.title)}`,
      time: relativeTime(updated ? t.updatedAt : t.createdAt),
      ts: new Date(updated ? t.updatedAt : t.createdAt).getTime(),
    });
  });
  logbook.forEach(x => {
    items.push({ icon: '▤', text: `<strong>${esc(x.author)}</strong> registró <strong class="linkable" data-view-link="logbook">${esc(x.title)}</strong>`, time: relativeTime(x.date), ts: new Date(x.date).getTime() });
  });
  return items.sort((a, b) => b.ts - a.ts).slice(0, 8);
}

/* ---------- Adjuntos (tickets y chat) ---------- */
const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.xlsx,.xls,.csv';
const ATTACH_MAX_FILES = 5;
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const isImageMime = m => ['image/png','image/jpeg','image/gif','image/webp'].includes(m);
function formatBytes(bytes){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
// Sube los archivos elegidos y devuelve los adjuntos ya registrados en el
// servidor (todavia sin vincular: se vinculan al crear el ticket/mensaje).
async function uploadFiles(fileList){
  const files=[...fileList];
  if(!files.length)return [];
  if(files.length>ATTACH_MAX_FILES)throw new Error(`Se pueden adjuntar hasta ${ATTACH_MAX_FILES} archivos por vez.`);
  const tooBig=files.find(f=>f.size>ATTACH_MAX_BYTES);
  if(tooBig)throw new Error(`"${tooBig.name}" supera los 10 MB permitidos.`);
  const form=new FormData();
  files.forEach(f=>form.append('files',f));
  const res=await fetch('/api/attachments',{method:'POST',body:form,credentials:'same-origin'});
  const text=await res.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=null;}}
  if(!res.ok)throw new Error(data?.error||'No se pudieron subir los archivos.');
  return data.attachments;
}
// Campo reutilizable: input de archivo + lista de lo ya adjuntado. Guarda los
// ids en un array que el formulario lee al enviar.
function attachmentField(id,label='Archivos adjuntos'){
  return `<div class="field form-span"><label>${label} <span class="muted" style="font-weight:400">· imágenes, PDF o planillas · hasta 10 MB c/u</span></label>`
    +`<input type="file" id="${id}-input" class="file-input" multiple accept="${ATTACH_ACCEPT}" />`
    +`<div class="attach-list" id="${id}-list"></div></div>`;
}
// Devuelve un objeto con .ids() para leer los adjuntos confirmados.
function wireAttachmentField(id){
  const input=document.getElementById(`${id}-input`);
  const list=document.getElementById(`${id}-list`);
  const state=[];
  if(!input||!list)return {ids:()=>[]};
  const paint=()=>{
    list.innerHTML=state.map(a=>`<div class="attach-item"><span class="attach-name">${esc(a.originalName)}</span><span class="attach-size">${formatBytes(a.size)}</span><button type="button" class="attach-remove" data-remove-attach="${a.id}" title="Quitar">×</button></div>`).join('');
    list.querySelectorAll('[data-remove-attach]').forEach(btn=>btn.onclick=()=>{
      const idx=state.findIndex(a=>a.id===btn.dataset.removeAttach);
      if(idx>=0)state.splice(idx,1);
      paint();
    });
  };
  input.onchange=async()=>{
    if(!input.files?.length)return;
    input.disabled=true;
    try{
      const uploaded=await uploadFiles(input.files);
      uploaded.forEach(a=>{ if(state.length<ATTACH_MAX_FILES)state.push(a); });
      paint();
    }catch(err){toast(err.message||'No se pudieron subir los archivos.');}
    finally{input.disabled=false;input.value='';}
  };
  return {ids:()=>state.map(a=>a.id)};
}
// Render de adjuntos ya guardados: las imagenes se ven, el resto se descarga.
function attachmentsHtml(list,compact=false){
  if(!list||!list.length)return '';
  return `<div class="attach-view ${compact?'compact':''}">`+list.map(a=>{
    const url=`/api/attachments/${encodeURIComponent(a.id)}`;
    if(isImageMime(a.mimeType)){
      return `<a class="attach-image" href="${url}" target="_blank" rel="noopener" title="${esc(a.originalName)}"><img src="${url}" alt="${esc(a.originalName)}" loading="lazy" /></a>`;
    }
    return `<a class="attach-file" href="${url}" target="_blank" rel="noopener"><span class="attach-file-icon">▤</span><span class="attach-name">${esc(a.originalName)}</span><span class="attach-size">${formatBytes(a.size)}</span></a>`;
  }).join('')+`</div>`;
}

/* ---------- Utilidades de presentacion ---------- */
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const employee = id => store.employees.find(x => x.id === id);
const equipment = id => store.equipment.find(x => x.id === id);
const statusClass = value => ({'Crítica':'b-red','Alta':'b-yellow','Nuevo':'b-blue','En proceso':'b-blue','Abierto':'b-blue','Esperando proveedor':'b-yellow','Esperando usuario':'b-yellow','Resuelto':'b-green','Cerrado':'b-green','Activo':'b-green','Inactivo':'b-gray','Bloqueado':'b-red','Baja':'b-gray','Media':'b-blue'}[value] || 'b-gray');
const badge = value => `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
const navItems = [ ['dashboard','⌂','Centro de operaciones'], ['tickets','◈','Tickets'], ['employees','♙','Personas'], ['equipment','▣','Equipos y espacios'], ['sectors','◫','Sectores'], ['logbook','▤','Bitácora técnica'], ['users','◉','Panel administrador'], ['chat','✉','Mensajes'] ];
// Equipos y tambien LUGARES: un ticket puede apuntar a una PC o a un
// consultorio/sala/puerta. Se carga solo lo que recibe pedidos, no un
// inventario exhaustivo de la empresa.
const EQUIPMENT_TYPES = ['PC','Notebook','Monitor','Teclado','Mouse','Scanner','Impresora','UPS','Teléfono IP','Lector','Consultorio','Oficina','Sala','Depósito','Puerta','Instalación','Otro'];
const isAdmin = () => currentUser?.role === 'Administrador';
const isSupervisor = () => currentUser?.role === 'Supervisor';
const isUser = () => currentUser?.role === 'User';
const isStaff = () => currentUser?.role !== 'User';

/* ---------- Vistas ---------- */
function loginView(){app.innerHTML=`<main class="login-page"><section class="login-card"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><h1>Centro de Soporte</h1><p>Ingresá con las credenciales proporcionadas por Sistemas.</p><form id="login-form"><div class="field"><label for="username">Usuario</label><input id="username" name="username" required autocomplete="username" autofocus /></div><div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" /></div><div class="login-actions" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Iniciar sesión</button></div></form></section></main>`;$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const submitBtn=e.currentTarget.querySelector('button[type=submit]');submitBtn.disabled=true;try{const {user}=await api('/auth/login',{method:'POST',body:{username:form.get('username'),password:form.get('password')}});applySessionUser(user);await render();}catch(err){toast(apiErrorMessage(err));}finally{submitBtn.disabled=false;}});}
function shell(content){const byId=ids=>navItems.filter(([id])=>ids.includes(id));const operacion=byId(['dashboard','tickets']);const informacion=byId(['employees','equipment','sectors']);const administracion=byId(['logbook','users']);const comunicacion=byId(['chat']);const staffNav=`<div class="nav-group">Operación</div>${operacion.map(nav).join('')}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${informacion.map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${administracion.map(nav).join('')}`:''}`;const employeeNav=`<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}`;const bellBadge=notifUnreadCount>0?`<span class="bell-badge">${notifUnreadCount>99?'99+':notifUnreadCount}</span>`:'';app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span><button class="bell" id="notif-bell" type="button" title="Notificaciones">🔔${bellBadge}</button></div><div id="notif-panel" class="notif-panel hidden"></div><nav class="nav">${isStaff()?staffNav:employeeNav}</nav><div class="sidebar-user"><strong>${esc(currentUser.name)}</strong><span>${esc(currentUser.role)}</span></div></aside><main class="main"><header class="topbar">${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions"><span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{currentView=el.dataset.view;currentDetailId=null;render();});$('#notif-bell').onclick=toggleNotifPanel;$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }session=false;currentUser=null;stopChatUnreadPolling();stopChatThreadPolling();chatConversations=[];chatGroups=[];activeChatConversationId=null;activeChatGroupId=null;chatMessages=[];chatUnreadCount=0;notifUnreadCount=0;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
const nav=([id,icon,label])=>{const badge=id==='chat'&&chatUnreadCount>0?`<span class="nav-badge">${chatUnreadCount>99?'99+':chatUnreadCount}</span>`:'';return `<button class="nav-item ${currentView===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;};
function keyHandler(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#global-search')?.focus();}if(e.key==='Escape'){closeModal();document.getElementById('notif-panel')?.classList.add('hidden');}}
function page(title,subtitle,button=''){return `<div class="page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`}
function dashboard(){const active=store.tickets.filter(t=>!['Resuelto','Cerrado','Cancelado'].includes(t.status));return page('Centro de operaciones','Visión general del soporte técnico.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<section class="metrics"><div class="metric"><div class="metric-label">Abiertos <span>◈</span></div><div class="metric-value">${active.length}</div><div class="metric-meta">requieren seguimiento</div></div><div class="metric urgent"><div class="metric-label">Urgentes <span>!</span></div><div class="metric-value">${store.tickets.filter(t=>t.priority==='Crítica').length}</div><div class="metric-meta">prioridad crítica</div></div><div class="metric live"><div class="metric-label">En proceso <span>↗</span></div><div class="metric-value">${store.tickets.filter(t=>t.status==='En proceso').length}</div><div class="metric-meta">con técnico asignado</div></div><div class="metric"><div class="metric-label">Esperando <span>◷</span></div><div class="metric-value">${store.tickets.filter(t=>t.status.startsWith('Esperando')).length}</div><div class="metric-meta">usuario o proveedor</div></div><div class="metric"><div class="metric-label">Resueltos <span>✓</span></div><div class="metric-value">${store.tickets.filter(t=>['Resuelto','Cerrado'].includes(t.status)).length}</div><div class="metric-meta">histórico registrado</div></div></section><section class="grid"><div class="panel"><div class="panel-head"><h2>Tickets que requieren atención</h2><a data-view="tickets">Ver todos</a></div>${ticketsTable(active)}</div><div class="panel"><div class="panel-head"><h2>Actividad reciente</h2>${isAdmin()?'<a data-view="logbook">Bitácora</a>':''}</div><div class="activity">${store.activity.length?store.activity.map(activity).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'}</div></div></section><section class="two-panels"><div class="panel"><div class="panel-head"><h2>Eventos importantes</h2>${isAdmin()?'<a data-view="logbook">Ver bitácora</a>':''}</div>${isAdmin()?(store.logbook.length?store.logbook.slice(0,3).map(e=>`<div class="event"><strong>${esc(e.title)}</strong><span>${esc(e.category)} · ${e.date} · ${esc(e.author)}</span></div>`).join(''):'<div class="empty">No hay eventos técnicos registrados.</div>'):'<div class="empty">Solo visible para Administrador.</div>'}</div><div class="panel"><div class="panel-head"><h2>Recordatorios</h2></div><div class="empty">No hay recordatorios pendientes.</div></div></section>`}
function ticketsTable(rows){const showActions=isStaff();return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ticket</th><th>Incidencia</th><th>Prioridad</th><th>Estado</th><th>Asignado</th>${showActions?'<th></th>':''}</tr></thead><tbody>${rows.map(t=>`<tr data-ticket="${t.id}"><td class="mono">${esc(t.code)}</td><td><strong>${esc(t.title)}</strong><br><span class="muted">${esc(employee(t.employee)?.name||t.employeeInfo?.name||'Sin empleado')}</span></td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${esc(t.technician||'Sin asignar')}</td>${showActions?`<td class="row-actions"><button class="btn-icon" type="button" data-quick-menu="${t.id}" title="Acciones rápidas">⋮</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${showActions?6:5}" class="empty">No hay tickets en esta vista.</td></tr>`}</tbody></table></div>`}
const activity=a=>`<div class="activity-item"><div class="activity-symbol">${a.icon}</div><div class="activity-copy">${a.text}</div><div class="activity-time">${a.time}</div></div>`;
function ticketsView(){return page('Tickets','Registro y seguimiento de incidencias.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, técnico o número…" data-filter="tickets" /></div><div class="panel" id="tickets-table">${ticketsTable(store.tickets)}</div>`}
function employeePortal(){const person=employee(currentUser.employeeId);return page('Solicitudes de soporte','Creá una solicitud para vos o para cualquier persona de la empresa.',`<button class="btn btn-primary" data-action="new-employee-ticket">+ Solicitar soporte</button>`)+`<section class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><span class="muted">${esc(person?.sectorName||'')}</span></div>${ticketsTable(store.tickets)}</section><section class="panel" style="margin-top:18px"><div class="side-card"><h3>¿Necesitás ayuda?</h3><p class="muted">Describí el problema, elegí a quién hay que asistir (vos u otra persona), la prioridad y, si corresponde, el equipo. Sistemas recibirá la solicitud y actualizará el estado.</p></div></section>`}
function employeesView(){return page('Personas','Ficha centralizada de colaboradores y su contexto técnico.',isAdmin()?`<button class="btn btn-primary" data-action="new-employee">+ Nueva persona</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, correo, interno o sector…" data-filter="employees" /></div><div class="panel" id="employees-table">${employeesTable(store.employees)}</div>`}
function employeesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Persona</th><th>Sector / Cargo</th><th>Horario</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-employee="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.sectorName||'Sin sector')}<br><span class="muted">${esc(x.position)}</span></td><td>${esc(x.workShift)}<br><span class="muted">${esc(x.schedule)}</span></td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="4" class="empty">No se encontraron personas.</td></tr>`}</tbody></table></div>`}
function equipmentView(){return page('Equipos y espacios','Todo aquello sobre lo que se puede pedir ayuda: equipos, consultorios, salas, instalaciones.',isAdmin()?`<button class="btn btn-primary" data-action="new-equipment">+ Nuevo equipo o espacio</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por tipo, nombre o sector…" data-filter="equipment" /></div><div class="panel" id="equipment-table">${equipmentTable(store.equipment)}</div>`}
function equipmentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Equipo o espacio</th><th>Sector</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr data-equipment="${x.id}"><td><strong>${esc(x.model)||esc(x.type)}</strong><br><span class="muted">${esc(x.type)} · ${esc(x.code)}</span></td><td>${esc(x.sectorName||'Sin sector')}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No se encontraron equipos ni espacios.</td></tr>`}</tbody></table></div>`}
function logbookView(){return page('Bitácora técnica','Eventos relevantes y cambios de infraestructura.',`<button class="btn btn-primary" data-action="new-log">+ Registrar evento</button>`)+`<section class="panel">${store.logbook.map(x=>`<div class="event"><div class="row-between"><strong>${esc(x.title)}</strong>${badge(x.category)}</div><span>${x.date} · ${esc(x.author)}</span><p class="muted">${esc(x.detail)}</p></div>`).join('')}</section>`}
function usersView(){return page('Panel administrador','Usuarios, roles y accesos de la plataforma.',`<button class="btn btn-primary" data-action="new-user">+ Crear usuario</button>`)+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Ingresos</th></tr></thead><tbody>${store.users.map(x=>`<tr data-user="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="mono">${esc(x.username)}</span></td><td>${esc(x.role)}</td><td>${badge(x.status)}</td><td>${esc(x.lastAccess)}</td><td>${x.logins}</td></tr>`).join('')}</tbody></table></div></section>`}
function employeeDetail(x){const relatedTickets=store.tickets.filter(t=>t.employee===x.id);return page('Ficha de persona','Contexto operativo unificado.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-employee="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.name)}</h2><p>${esc(x.position)} · ${esc(x.sectorName||'Sin sector')}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Correo</label>${esc(x.email)}</div><div class="info"><label>Interno</label>${esc(x.extension)}</div><div class="info"><label>Horario</label>${esc(x.workShift)} · ${esc(x.schedule)}</div><div class="info"><label>Reemplazo</label>${esc(x.replacementInfo?.name||'No definido')}</div></div></div><div class="panel-head"><h2>Tickets relacionados</h2></div>${ticketsTable(relatedTickets)}</section><aside><div class="panel side-card"><h3>Equipamiento del sector</h3>${x.sectorEquipment.map(e=>`<div class="event linkable" data-equipment="${e.id}"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">No hay equipamiento registrado en este sector.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Notas técnicas</h3>${x.notes?`<div class="note">${esc(x.notes)}</div>`:'<p class="muted">Sin observaciones registradas.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía.</p>'}</div></aside></div>`}
function equipmentDetail(x){const tickets=store.tickets.filter(t=>t.equipment===x.id);return page('Detalle de equipamiento','Información, historial de cambios y tickets asociados.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-equipment="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.model)||esc(x.type)}</h2><p>${esc(x.type)} · ${esc(x.code)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Sector</label>${esc(x.sectorName||'Sin asignar')}</div></div></div><div class="panel-head"><h2>Tickets asociados</h2></div>${ticketsTable(tickets)}</section><aside><div class="panel side-card"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía. Cada edición del equipo deja acá su historial automático.</p>'}</div></aside></div>`}
function sectorsView(){return page('Sectores y turnos','Catálogo compartido por Personas, Equipos y Tickets.',isAdmin()?`<button class="btn btn-primary" data-action="new-sector">+ Nuevo sector</button>`:'')+`<div class="panel" id="sectors-table">${sectorsTable(store.sectors)}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Turnos de soporte</h2>${isAdmin()?'<button class="btn btn-ghost" data-action="new-schedule">+ Nuevo turno</button>':''}</div><div id="schedules-table">${schedulesTable(store.schedules)}</div></section>`}
function sectorsTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Sector</th><th>Estado</th></tr></thead><tbody>${rows.map(s=>`<tr data-sector="${s.id}"><td><strong>${esc(s.name)}</strong></td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay sectores creados todavía.</td></tr>`}</tbody></table></div>`}
function schedulesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Turno</th><th>Horario</th><th>Estado</th></tr></thead><tbody>${rows.map(s=>`<tr data-schedule="${s.id}"><td><strong>${esc(s.name)}</strong></td><td class="mono">${esc(s.startTime)}–${esc(s.endTime)}</td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No hay turnos creados todavía.</td></tr>`}</tbody></table></div>`}
function sectorDetail(x){
  const peopleRows=x.people.map(p=>`<tr data-employee="${p.id}"><td>${esc(p.name)}</td><td>${badge(p.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay personas en este sector.</td></tr>`;
  // Categorias de ticket de ESTE sector: son las que van a aparecer al crear
  // un ticket dirigido aca. Las administra el Admin desde este mismo panel.
  const categoryRows=x.categories.length
    ? x.categories.map(c=>`<div class="cat-item"><span>${esc(c.name)}</span>${isAdmin()?`<button type="button" class="cat-remove" data-remove-category="${c.id}" data-sector="${x.id}" title="Eliminar categoría">×</button>`:''}</div>`).join('')
    : '<p class="muted">Todavía no hay categorías. Al crear un ticket para este sector se usará "General".</p>';
  const categoryForm=isAdmin()
    ? `<form class="cat-form" id="cat-form" data-sector-id="${x.id}"><input name="name" placeholder="Nueva categoría (ej. Arreglar)" maxlength="80" required /><button class="btn btn-primary" type="submit">Agregar</button></form>`
    : '';
  return page('Detalle de sector','Personas, equipos y categorías de ticket de este sector.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-sector="${x.id}">Editar</button>`:'')
    +`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><h2>${esc(x.name)}</h2>${badge(x.status)}</div></div>`
    +`<div class="panel-head"><h2>Personas (${x.people.length})</h2></div><div class="table-wrap"><table class="data-table"><tbody>${peopleRows}</tbody></table></div></section>`
    +`<aside><div class="panel side-card"><h3>Categorías de ticket (${x.categories.length})</h3><p class="muted" style="margin:0 0 10px;font-size:12px">Aparecen al crear un ticket dirigido a este sector.</p><div class="cat-list">${categoryRows}</div>${categoryForm}</div>`
    +`<div class="panel side-card" style="margin-top:18px"><h3>Equipos y espacios (${x.equipmentList.length})</h3>${x.equipmentList.map(e=>`<div class="event linkable" data-equipment="${e.id}"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">Sin equipos ni espacios en este sector.</p>'}</div></aside></div>`;
}
// Alta y baja de categorias desde el detalle del sector (solo Admin).
function wireSectorCategories(){
  const form=document.getElementById('cat-form');
  if(form){
    form.onsubmit=async e=>{
      e.preventDefault();
      const name=form.elements.name.value.trim();
      if(!name)return;
      const btn=form.querySelector('button[type=submit]');
      btn.disabled=true;
      try{
        await api(`/sectors/${form.dataset.sectorId}/categories`,{method:'POST',body:{name}});
        toast('Categoría agregada.');
        render();
      }catch(err){toast(apiErrorMessage(err));btn.disabled=false;}
    };
  }
  document.querySelectorAll('[data-remove-category]').forEach(btn=>btn.onclick=async()=>{
    if(!window.confirm('¿Eliminar esta categoría? Los tickets que ya la usaron no se modifican.'))return;
    try{
      await api(`/sectors/${btn.dataset.sector}/categories/${btn.dataset.removeCategory}`,{method:'DELETE'});
      toast('Categoría eliminada.');
      render();
    }catch(err){toast(apiErrorMessage(err));}
  });
}
// El listado no trae los adjuntos (seria pesado): se piden al abrir el
// detalle, que es cuando de verdad se necesitan.
async function ticketDetail(listTicket){
  let ticket=listTicket;
  try{const res=await api(`/tickets/${listTicket.id}`);ticket=normalizeTicket(res.ticket);}
  catch(err){handleApiError(err);return;}

  const affected=ticket.employeeInfo||employee(ticket.employee);
  const requester=ticket.requestedByInfo||affected;
  const device=ticket.equipmentInfo;
  const shift=ticket.scheduleInfo?`${ticket.scheduleInfo.name} · ${ticket.scheduleInfo.startTime}–${ticket.scheduleInfo.endTime}`:'No indicado';
  const files=attachmentsHtml(ticket.attachments);
  const context=`<div class="form-span"><div class="note"><strong>${esc(ticket.code)} · ${esc(ticket.title)}</strong><br>${esc(ticket.description||'Sin descripción adicional.')}<br><br><b>Persona a asistir:</b> ${esc(affected?.name||'No indicada')} · <b>Solicitó:</b> ${esc(requester?.name||affected?.name||'No indicado')}<br><b>Sector:</b> ${esc(ticket.sectorInfo?.name||'No indicado')} · <b>Turno de soporte:</b> ${esc(shift)}<br><b>Equipo o espacio:</b> ${esc(device?`${device.model} (${device.type})`:'No corresponde')} · <b>Categoría:</b> ${esc(ticket.category||'General')}<br><b>Creado:</b> ${esc(formatDateTime(ticket.createdAt))}</div>${files?`<div class="attach-block"><label>Archivos adjuntos</label>${files}</div>`:''}</div>`;

  if(!isStaff()){
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>Solicitud ${esc(ticket.code)}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${context}</div><div class="modal-actions"><button class="btn btn-primary" type="button" data-close>Cerrar</button></div></div></section></div>`;
    $('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;
    return;
  }
  const technicians=store.technicians.map(x=>[x.id,x.name]);
  modal(`Gestionar ${ticket.code}`,context
    +select('status','Estado',['Nuevo','Abierto','En proceso','Esperando usuario','Esperando proveedor','Resuelto','Cerrado','Cancelado'])
    +select('priority','Prioridad',['Baja','Media','Alta','Crítica'])
    +select('technician','Asignado a',[['','Sin asignar'],...technicians])
    +`<div class="field form-span"><label>Solución aplicada</label><textarea name="solution">${esc(ticket.solution||'')}</textarea></div>`,
    f=>updateTicket(ticket,f));
  const form=$('#entry-form');
  form.elements.status.value=ticket.status;
  form.elements.priority.value=ticket.priority;
  form.elements.technician.value=ticket.technicianId||'';
}
async function updateTicket(ticket, values){const payload={status:values.get('status'),priority:values.get('priority'),technicianId:values.get('technician')||'',solution:values.get('solution')||''};const {ticket:updated}=await api(`/tickets/${ticket.id}`,{method:'PATCH',body:payload});const normalized=normalizeTicket(updated);const idx=store.tickets.findIndex(t=>t.id===ticket.id);if(idx>=0)store.tickets[idx]=normalized;}

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

// Categorias del sector elegido: cada sector define las suyas desde su propia
// pantalla, asi que la lista cambia con el desplegable de Sector.
function categoriesForSector(sectorId){
  return store.categories.filter(c=>c.sectorId===sectorId).map(c=>c.name);
}
function categoryOptionsHtml(sectorId){
  const names=categoriesForSector(sectorId);
  if(!names.length)return `<option value="">${esc(sectorId?'Este sector no tiene categorías cargadas':'Elegí un sector primero')}</option>`;
  return names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
}
function ticketFields(defaultPersonId=''){
  const equipmentOptions=[['','No corresponde'],...store.equipment.map(x=>[x.id,`${x.model||x.type} · ${x.type}`])];
  const peopleOptions=store.employees.map(x=>[x.id,`${x.name} · ${x.sectorName||'Sin sector'}`]);
  const scheduleOptions=[['','No indicado'],...store.schedules.map(s=>[s.id,`${s.name} · ${s.startTime}–${s.endTime}`])];
  // Si no se indica una persona, el desplegable igual va a mostrar la primera
  // de la lista: se usa ESA para el sector y las categorias iniciales, asi el
  // formulario arranca coherente con lo que se ve seleccionado (antes el
  // sector quedaba "Sin definir", la lista de categorias vacia, y al guardar
  // el backend exigia una categoria que nunca se habia podido elegir).
  const personId=defaultPersonId||store.employees[0]?.id||'';
  const person=employee(personId);
  const sectorId=person?.sectorId||'';
  return select('employee','Persona a asistir',peopleOptions,personId)
    +select('requestedBy','Solicitud informada por',peopleOptions,personId)
    +field('title','Título breve','text','form-span')
    +select('equipment','Equipo o espacio relacionado',equipmentOptions)
    +sectorField(sectorId)
    +`<div class="field"><label>Categoría</label><select name="category">${categoryOptionsHtml(sectorId)}</select></div>`
    +select('priority','Prioridad',['Media','Baja','Alta','Crítica'])
    +select('scheduleId','Turno de soporte',scheduleOptions)
    +requiredTextArea('description','Descripción del inconveniente','form-span')
    +attachmentField('ticket-attach');
}
async function createTicket(values,attachIds){const payload={title:values.get('title'),description:values.get('description'),employeeId:values.get('employee')||'',requestedById:values.get('requestedBy')||'',equipmentId:values.get('equipment')||'',sectorId:values.get('sectorId')||'',scheduleId:values.get('scheduleId')||'',category:values.get('category')||'',priority:values.get('priority'),attachmentIds:attachIds||[]};const {ticket}=await api('/tickets',{method:'POST',body:payload});store.tickets.unshift(normalizeTicket(ticket));}
// Al elegir un equipo/espacio, el sector se completa solo con el sector
// ACTUAL de ese equipo (siempre sincronizado). Al cambiar la persona, se
// propone el suyo. Y cada vez que cambia el sector, la lista de categorias
// se rearma con las de ese sector.
function wireTicketFormAutoselect(){
  const form=$('#entry-form');
  if(!form)return;
  const sectorSel=form.elements.sectorId;
  const catSel=form.elements.category;
  const refreshCategories=()=>{ if(catSel&&sectorSel)catSel.innerHTML=categoryOptionsHtml(sectorSel.value); };
  sectorSel?.addEventListener('change',refreshCategories);
  form.elements.equipment?.addEventListener('change',()=>{
    const eq=store.equipment.find(x=>x.id===form.elements.equipment.value);
    if(eq&&sectorSel){sectorSel.value=eq.sectorId||'';refreshCategories();}
  });
  form.elements.employee?.addEventListener('change',()=>{
    const p=employee(form.elements.employee.value);
    if(p&&sectorSel&&!form.elements.equipment.value){sectorSel.value=p.sectorId||'';refreshCategories();}
  });
  refreshCategories();
}
function openNew(kind){
 if(kind==='ticket'){let att;modal('Nuevo ticket',ticketFields(''),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee-ticket'){let att;modal('Solicitar soporte',ticketFields(currentUser.employeeId),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee')modal('Nueva persona',field('name','Nombre y apellido')+field('email','Correo','email')+sectorField()+field('position','Cargo')+field('extension','Interno')+field('phone','Teléfono')+select('workShift','Turno laboral',['Mañana','Tarde','Jornada completa','Otro'])+field('schedule','Horario habitual')+select('replacement','Reemplazo habitual',[['','No definido'],...store.employees.map(x=>[x.id,x.name])])+field('notes','Observaciones','textarea','form-span'),async f=>{const payload={name:f.get('name'),email:f.get('email')||undefined,sectorId:f.get('sectorId')||'',position:f.get('position')||undefined,extension:f.get('extension')||undefined,phone:f.get('phone')||undefined,workShift:f.get('workShift')||undefined,schedule:f.get('schedule')||undefined,replacementId:f.get('replacement')||'',notes:f.get('notes')||undefined};const {employee:created}=await api('/employees',{method:'POST',body:payload});store.employees.push(normalizeEmployee(created));});
 if(kind==='equipment')modal('Nuevo equipo o espacio',select('type','Tipo',EQUIPMENT_TYPES)+field('model','Nombre o identificación')+sectorField(),async f=>{const payload={type:f.get('type'),model:f.get('model'),sectorId:f.get('sectorId')||''};const {equipment:created}=await api('/equipment',{method:'POST',body:payload});store.equipment.push(normalizeEquipment(created));});
 if(kind==='log')modal('Registrar evento',field('title','Título','text','form-span')+select('category','Categoría',['Mantenimiento','Infraestructura','Seguridad','Cambio','Actualización'])+field('detail','Detalle técnico','textarea','form-span'),async f=>{const payload={title:f.get('title'),category:f.get('category'),detail:f.get('detail')};const {entry}=await api('/logbook',{method:'POST',body:payload});store.logbook.unshift(normalizeLogbookEntry(entry));});
 if(kind==='user')modal('Crear usuario',field('name','Nombre completo')+field('username','Usuario')+field('password','Contraseña inicial','password')+select('role','Rol',['Administrador','Supervisor','User'])+select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name])]),async f=>{const payload={name:f.get('name'),username:f.get('username'),password:f.get('password'),role:f.get('role'),employeeId:f.get('role')==='User'?(f.get('employee')||''):''};const {user:created}=await api('/users',{method:'POST',body:payload});store.users.push(normalizeUser(created));});
 if(kind==='sector')modal('Nuevo sector',field('name','Nombre del sector'),async f=>{const {sector:created}=await api('/sectors',{method:'POST',body:{name:f.get('name')}});store.sectors.push(normalizeSector(created));});
 if(kind==='schedule')modal('Nuevo turno',field('name','Nombre del turno')+textValue('startTime','Inicio (HH:MM)','')+textValue('endTime','Fin (HH:MM)',''),async f=>{const {schedule:created}=await api('/schedules',{method:'POST',body:{name:f.get('name'),startTime:f.get('startTime'),endTime:f.get('endTime')}});store.schedules.push(normalizeSchedule(created));});
}

/* ---------- Personas y Equipos: edicion (solo Admin) con historial de Cambios ---------- */
function openEmployeeEdit(id){
  const x=store.employees.find(e=>e.id===id);
  if(!x)return;
  const fields=textValue('name','Nombre y apellido',x.name)
    +textValue('email','Correo',x.email==='—'?'':x.email)
    +sectorField(x.sectorId)
    +textValue('position','Cargo',x.position)
    +textValue('extension','Interno',x.extension)
    +textValue('phone','Teléfono',x.phone)
    +select('workShift','Turno laboral',['Mañana','Tarde','Jornada completa','Otro'],x.workShift)
    +textValue('schedule','Horario habitual',x.schedule)
    +select('status','Estado',['Activo','Inactivo'],x.status)
    +`<div class="field form-span"><label>Observaciones</label><textarea name="notes">${esc(x.notes||'')}</textarea></div>`;
  modal(`Editar ${x.name}`,fields,async f=>{
    const payload={name:f.get('name'),email:f.get('email')||'',sectorId:f.get('sectorId')||'',position:f.get('position')||'',extension:f.get('extension')||'',phone:f.get('phone')||'',workShift:f.get('workShift')||'',schedule:f.get('schedule')||'',status:f.get('status'),notes:f.get('notes')||''};
    const {employee:updated}=await api(`/employees/${x.id}`,{method:'PATCH',body:payload});
    const idx=store.employees.findIndex(e=>e.id===x.id);
    if(idx>=0)store.employees[idx]=normalizeEmployee(updated);
  });
  // Los textValue son required por defecto; estos campos son opcionales.
  ['email','position','extension','phone','schedule'].forEach(n=>{const el=$('#entry-form').elements[n];if(el)el.required=false;});
}
function openEquipmentEdit(id){
  const x=equipment(id);
  if(!x)return;
  const fields=select('type','Tipo',EQUIPMENT_TYPES,x.type)
    +textValue('model','Nombre o identificación',x.model)
    +sectorField(x.sectorId)
    +select('status','Estado',['Activo','Inactivo'],x.status);
  modal(`Editar ${x.model||x.type}`,fields,async f=>{
    const payload={type:f.get('type'),model:f.get('model'),sectorId:f.get('sectorId')||'',status:f.get('status')};
    const {equipment:updated}=await api(`/equipment/${x.id}`,{method:'PATCH',body:payload});
    const idx=store.equipment.findIndex(e=>e.id===x.id);
    if(idx>=0)store.equipment[idx]=normalizeEquipment(updated);
  });
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
    +`<div class="field form-span"><label>Nueva contraseña (opcional)</label><input name="password" type="password" placeholder="Dejar en blanco para no cambiarla" autocomplete="new-password" /></div>`
    +`<div class="field form-span"><label>Cambios de esta cuenta</label>${u.changeLog?`<div class="note changelog">${esc(u.changeLog)}</div>`:'<p class="muted" style="margin:4px 0">Sin cambios registrados todavía.</p>'}</div>`;
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

function select(name,label,items,selected){return `<div class="field"><label>${label}</label><select name="${name}">${items.map(x=>{const v=Array.isArray(x)?x[0]:x;const l=Array.isArray(x)?x[1]:x;const sel=selected!==undefined&&String(v)===String(selected)?' selected':'';return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;}).join('')}</select></div>`}
function toast(message){const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),3000);}
function wireRecords(root=document){
  root.querySelectorAll('[data-employee]').forEach(x=>x.onclick=e=>{e.stopPropagation();currentView='employee-detail';render(x.dataset.employee);});
  root.querySelectorAll('[data-equipment]').forEach(x=>x.onclick=e=>{e.stopPropagation();currentView='equipment-detail';render(x.dataset.equipment);});
  root.querySelectorAll('[data-ticket]').forEach(x=>x.onclick=e=>{e.stopPropagation();const ticket=store.tickets.find(y=>y.id===x.dataset.ticket);if(ticket)ticketDetail(ticket);});
  root.querySelectorAll('[data-view-link]').forEach(x=>x.onclick=e=>{e.stopPropagation();currentView=x.dataset.viewLink;currentDetailId=null;render();});
  root.querySelectorAll('[data-user]').forEach(x=>x.onclick=()=>openUserEdit(x.dataset.user));
  root.querySelectorAll('[data-quick-menu]').forEach(x=>x.onclick=e=>{e.stopPropagation();openQuickMenu(x,x.dataset.quickMenu);});
  root.querySelectorAll('[data-sector]').forEach(x=>x.onclick=()=>{currentView='sector-detail';render(x.dataset.sector);});
  // Editar turnos/sectores/personas/equipos: solo Admin (Supervisor solo mira).
  if(isAdmin()){
    root.querySelectorAll('[data-schedule]').forEach(x=>x.onclick=()=>openScheduleEdit(x.dataset.schedule));
    root.querySelectorAll('[data-edit-sector]').forEach(x=>x.onclick=()=>openSectorEdit(x.dataset.editSector));
    root.querySelectorAll('[data-edit-employee]').forEach(x=>x.onclick=()=>openEmployeeEdit(x.dataset.editEmployee));
    root.querySelectorAll('[data-edit-equipment]').forEach(x=>x.onclick=()=>openEquipmentEdit(x.dataset.editEquipment));
  }
}
function wirePage(){document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>openNew(x.dataset.action.replace('new-','')));document.querySelectorAll('.filter').forEach(input=>input.oninput=()=>{const q=input.value.toLowerCase();const kind=input.dataset.filter;const rows=store[kind].filter(x=>Object.values(x).join(' ').toLowerCase().includes(q));$(`#${kind}-table`).innerHTML=kind==='tickets'?ticketsTable(rows):kind==='employees'?employeesTable(rows):equipmentTable(rows);wireRecords($(`#${kind}-table`));});wireRecords();}

/* ---------- Chat interno (1 a 1 y grupos) ---------- */
function chatConvRowHtml(c){
  const previewText=c.lastMessage?(c.lastMessage.mine?'Vos: ':'')+c.lastMessage.body:'Sin mensajes todavía.';
  const badge=c.unreadCount>0?`<span class="chat-conv-badge">${c.unreadCount>99?'99+':c.unreadCount}</span>`:'';
  return `<div class="chat-conv ${c.id===activeChatConversationId?'active':''}" data-conversation="${c.id}"><div class="chat-conv-row"><strong>${esc(c.otherUser.name)}</strong>${badge}</div><div class="chat-conv-preview">${esc(previewText)}</div></div>`;
}
// Los grupos van SIEMPRE primeros en la lista (fijados), con su etiqueta.
function chatGroupRowHtml(g){
  const previewText=g.lastMessage?`${g.lastMessage.mine?'Vos':g.lastMessage.senderName}: ${g.lastMessage.body}`:'Sin mensajes todavía.';
  const badge=g.unreadCount>0?`<span class="chat-conv-badge">${g.unreadCount>99?'99+':g.unreadCount}</span>`:'';
  return `<div class="chat-conv ${g.id===activeChatGroupId?'active':''}" data-group="${g.id}"><div class="chat-conv-row"><strong><span class="chat-group-tag">Grupo</span> ${esc(g.name)}</strong>${badge}</div><div class="chat-conv-preview">${esc(previewText)}</div></div>`;
}
function chatListHtml(){
  const rows=[...chatGroups.map(chatGroupRowHtml),...chatConversations.map(chatConvRowHtml)];
  return rows.length?rows.join(''):'<div class="empty">Todavía no tenés conversaciones.</div>';
}
async function chatView(){
  const {conversations,groups}=await api('/chat/conversations');
  chatConversations=conversations;
  chatGroups=groups;
  const buttons=`${isAdmin()?'<button class="btn btn-ghost" type="button" data-chat-new-group>+ Nuevo grupo</button> ':''}<button class="btn btn-primary" type="button" data-chat-new>+ Nueva conversación</button>`;
  return page('Mensajes','Chat interno entre usuarios de la plataforma, sin salir de CIGST.',`<span>${buttons}</span>`)
    +`<div class="chat-layout"><div class="panel chat-list">${chatListHtml()}</div><div class="panel chat-thread" id="chat-thread"><div class="empty">Elegí una conversación para ver los mensajes.</div></div></div>`;
}
function wireChatList(){
  document.querySelectorAll('[data-conversation]').forEach(el=>el.onclick=()=>openChatThread(el.dataset.conversation));
  document.querySelectorAll('[data-group]').forEach(el=>el.onclick=()=>openGroupThread(el.dataset.group));
}
function wireChatView(){
  wireChatList();
  const newBtn=document.querySelector('[data-chat-new]');
  if(newBtn)newBtn.onclick=openNewChatPicker;
  const newGroupBtn=document.querySelector('[data-chat-new-group]');
  if(newGroupBtn)newGroupBtn.onclick=openNewGroupModal;
  if(activeChatGroupId&&chatGroups.some(g=>g.id===activeChatGroupId)){
    openGroupThread(activeChatGroupId);
  }else if(activeChatConversationId&&chatConversations.some(c=>c.id===activeChatConversationId)){
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
  const sender=m.senderName&&!m.mine?`<div class="chat-bubble-sender">${esc(m.senderName)}</div>`:'';
  const text=m.body?`<div class="chat-bubble-text">${esc(m.body)}</div>`:'';
  const files=attachmentsHtml(m.attachments,true);
  return `<div class="chat-bubble ${m.mine?'mine':''}">${sender}${text}${files}<div class="chat-bubble-time">${formatDateTime(m.createdAt)}</div></div>`;
}
function renderChatMessagesInner(hasMore){
  return (hasMore?'<button type="button" class="btn btn-ghost chat-load-more" id="chat-load-more">Cargar mensajes anteriores</button>':'')+chatMessages.map(chatBubble).join('');
}
function renderChatThreadShell(otherName,hasMore,headExtra=''){
  return `<div class="chat-thread-head"><div class="row-between"><strong>${esc(otherName)}</strong>${headExtra}</div></div>`
    +`<div class="chat-messages" id="chat-messages">${renderChatMessagesInner(hasMore)}</div>`
    +`<div class="attach-list" id="chat-attach-list"></div>`
    +`<form class="chat-composer" id="chat-composer">`
      +`<label class="attach-btn" title="Adjuntar archivo">📎<input type="file" id="chat-attach-input" multiple accept="${ATTACH_ACCEPT}" hidden /></label>`
      +`<textarea name="body" maxlength="2000" placeholder="Escribí un mensaje o adjuntá un archivo… (Enter para enviar)"></textarea>`
      +`<button class="btn btn-primary" type="submit">Enviar</button>`
    +`</form>`;
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
function markActiveChatRow(){
  document.querySelectorAll('[data-conversation]').forEach(el=>el.classList.toggle('active',el.dataset.conversation===activeChatConversationId));
  document.querySelectorAll('[data-group]').forEach(el=>el.classList.toggle('active',el.dataset.group===activeChatGroupId));
}
async function openChatThread(conversationId){
  activeChatConversationId=conversationId;
  activeChatGroupId=null;
  stopChatThreadPolling();
  markActiveChatRow();
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
  wireChatLoadMore({conversationId},hasMore);
  try{await api(`/chat/conversations/${conversationId}/read`,{method:'POST'});}catch{ /* si falla, se reintenta en el proximo poll */ }
  if(conv)conv.unreadCount=0;
  refreshChatUnreadBadge();
  startChatThreadPolling({conversationId});
}
async function openGroupThread(groupId){
  activeChatGroupId=groupId;
  activeChatConversationId=null;
  stopChatThreadPolling();
  markActiveChatRow();
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML='<div class="empty">Cargando…</div>';
  const group=chatGroups.find(g=>g.id===groupId);
  let messages,hasMore;
  try{({messages,hasMore}=await api(`/chat/groups/${groupId}/messages`));}
  catch(err){toast(apiErrorMessage(err));pane.innerHTML='<div class="empty">No se pudo cargar el grupo.</div>';return;}
  chatMessages=messages;
  const headExtra=`<span class="muted" style="font-size:12px">${group?group.memberCount:''} integrantes${isAdmin()?` · <button class="btn btn-ghost" type="button" data-edit-group="${groupId}" style="padding:4px 8px;font-size:12px">Editar</button>`:''}</span>`;
  pane.innerHTML=renderChatThreadShell(group?`Grupo · ${group.name}`:'Grupo',hasMore,headExtra);
  scrollChatToBottom();
  const editBtn=pane.querySelector('[data-edit-group]');
  if(editBtn)editBtn.onclick=()=>openGroupEdit(groupId);
  wireChatComposer({groupId});
  wireChatLoadMore({groupId},hasMore);
  try{await api(`/chat/groups/${groupId}/read`,{method:'POST'});}catch{ /* si falla, se reintenta en el proximo poll */ }
  if(group)group.unreadCount=0;
  refreshChatUnreadBadge();
  startChatThreadPolling({groupId});
}
function openNewThreadComposer(recipientId,recipientName){
  activeChatConversationId=null;
  activeChatGroupId=null;
  chatMessages=[];
  stopChatThreadPolling();
  markActiveChatRow();
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML=renderChatThreadShell(recipientName,false);
  wireChatComposer({pendingRecipientId:recipientId});
}
function chatMessagesEndpoint(target){
  return target.groupId?`/chat/groups/${target.groupId}/messages`:`/chat/conversations/${target.conversationId}/messages`;
}
function wireChatLoadMore(target,hasMore){
  const btn=document.getElementById('chat-load-more');
  if(!btn)return;
  if(!hasMore){btn.remove();return;}
  btn.onclick=async()=>{
    const oldestId=chatMessages[0]?.id;
    if(!oldestId)return;
    btn.disabled=true;
    try{
      const {messages,hasMore:more}=await api(`${chatMessagesEndpoint(target)}?before=${oldestId}`);
      const container=document.getElementById('chat-messages');
      const prevScrollHeight=container.scrollHeight;
      chatMessages=[...messages,...chatMessages];
      container.innerHTML=renderChatMessagesInner(more);
      wireChatLoadMore(target,more);
      container.scrollTop=container.scrollHeight-prevScrollHeight;
    }catch(err){toast(apiErrorMessage(err));btn.disabled=false;}
  };
}
function wireChatComposer(target){
  const form=document.getElementById('chat-composer');
  if(!form)return;
  const textarea=form.querySelector('textarea[name=body]');
  // Adjuntos pendientes de este mensaje: se suben al elegirlos y se vinculan
  // recien al enviar (igual que en el formulario de ticket).
  const input=document.getElementById('chat-attach-input');
  const list=document.getElementById('chat-attach-list');
  let pending=[];
  const paintPending=()=>{
    if(!list)return;
    list.innerHTML=pending.map(a=>`<div class="attach-item"><span class="attach-name">${esc(a.originalName)}</span><span class="attach-size">${formatBytes(a.size)}</span><button type="button" class="attach-remove" data-remove-attach="${a.id}" title="Quitar">×</button></div>`).join('');
    list.querySelectorAll('[data-remove-attach]').forEach(btn=>btn.onclick=()=>{
      pending=pending.filter(a=>a.id!==btn.dataset.removeAttach);
      paintPending();
    });
  };
  if(input){
    input.onchange=async()=>{
      if(!input.files?.length)return;
      input.disabled=true;
      try{
        const uploaded=await uploadFiles(input.files);
        uploaded.forEach(a=>{ if(pending.length<ATTACH_MAX_FILES)pending.push(a); });
        paintPending();
      }catch(err){toast(err.message||'No se pudieron subir los archivos.');}
      finally{input.disabled=false;input.value='';}
    };
  }
  form.onsubmit=async e=>{
    e.preventDefault();
    const body=textarea.value.trim();
    const attachmentIds=pending.map(a=>a.id);
    if(!body&&!attachmentIds.length)return;
    const submitBtn=form.querySelector('button[type=submit]');
    submitBtn.disabled=true;
    try{
      if(target.conversationId||target.groupId){
        const {message}=await api(chatMessagesEndpoint(target),{method:'POST',body:{body,attachmentIds}});
        appendChatMessage(message);
      }else{
        const {conversation,message}=await api('/chat/conversations',{method:'POST',body:{recipientId:target.pendingRecipientId,body,attachmentIds}});
        activeChatConversationId=conversation.id;
        // Reasigna el target capturado por este mismo closure: el segundo
        // mensaje en adelante ya usa el conversationId real, sin re-wirear el form.
        target={conversationId:conversation.id};
        appendChatMessage(message);
        startChatThreadPolling(target);
        refreshChatConversationList();
      }
      textarea.value='';
      pending=[];
      paintPending();
    }catch(err){toast(apiErrorMessage(err));}
    finally{submitBtn.disabled=false;}
  };
  textarea.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}
  });
}
async function refreshChatConversationList(){
  try{
    const {conversations,groups}=await api('/chat/conversations');
    chatConversations=conversations;
    chatGroups=groups;
    const listEl=document.querySelector('.chat-list');
    if(listEl){
      listEl.innerHTML=chatListHtml();
      wireChatList();
    }
  }catch{ /* silencioso: no interrumpe la conversacion abierta */ }
}
function startChatThreadPolling(target){
  stopChatThreadPolling();
  const readEndpoint=target.groupId?`/chat/groups/${target.groupId}/read`:`/chat/conversations/${target.conversationId}/read`;
  chatThreadPollHandle=setInterval(async()=>{
    const lastId=chatMessages[chatMessages.length-1]?.id;
    if(!lastId)return;
    try{
      const {messages}=await api(`${chatMessagesEndpoint(target)}?after=${lastId}`);
      if(messages.length){
        messages.forEach(appendChatMessage);
        try{await api(readEndpoint,{method:'POST'});}catch{ /* se reintenta en el proximo poll */ }
      }
    }catch{ /* un poll fallido no debe interrumpir la conversacion */ }
  },CHAT_THREAD_POLL_MS);
}

/* ---------- Grupos: alta y edicion (solo Admin) ---------- */
function groupMemberCheckboxes(users,selectedIds){
  const sel=new Set(selectedIds||[]);
  const rows=users.map(u=>`<label class="member-item"><input type="checkbox" name="memberIds" value="${esc(u.id)}"${sel.has(u.id)?' checked':''}/><span class="member-name">${esc(u.name)}</span><span class="member-role">${esc(u.role)}</span></label>`).join('');
  return `<div class="field form-span"><label>Integrantes (${users.length})</label><div class="member-list">${rows||'<p class="muted" style="padding:12px">No hay otros usuarios activos.</p>'}</div></div>`;
}
async function openNewGroupModal(){
  let users;
  try{({users}=await api('/chat/directory'));}catch(err){toast(apiErrorMessage(err));return;}
  modal('Nuevo grupo',field('name','Nombre del grupo','text','form-span')+groupMemberCheckboxes(users,[]),async f=>{
    const memberIds=f.getAll('memberIds');
    await api('/chat/groups',{method:'POST',body:{name:f.get('name'),memberIds}});
    activeChatGroupId=null;
  });
}
async function openGroupEdit(groupId){
  const group=chatGroups.find(g=>g.id===groupId);
  if(!group)return;
  let users;
  try{({users}=await api('/chat/directory'));}catch(err){toast(apiErrorMessage(err));return;}
  // El directorio excluye al propio usuario: el admin se agrega a mano para
  // poder verse (y sacarse) de la lista de integrantes.
  const all=[{id:currentUser.id,name:`${currentUser.name} (vos)`,role:currentUser.role},...users];
  const memberIds=group.members.map(m=>m.id);
  modal(`Editar grupo «${group.name}»`,textValue('name','Nombre del grupo',group.name)+groupMemberCheckboxes(all,memberIds),async f=>{
    await api(`/chat/groups/${groupId}`,{method:'PATCH',body:{name:f.get('name'),memberIds:f.getAll('memberIds')}});
  });
  const deleteBtn=document.createElement('button');
  deleteBtn.type='button';deleteBtn.className='btn btn-danger';deleteBtn.textContent='Eliminar grupo';
  deleteBtn.onclick=async()=>{
    if(!window.confirm(`¿Eliminar el grupo "${group.name}" y todos sus mensajes?`))return;
    try{
      await api(`/chat/groups/${groupId}`,{method:'DELETE'});
      closeModal();
      activeChatGroupId=null;
      toast('Grupo eliminado.');
      render();
    }catch(err){toast(apiErrorMessage(err));}
  };
  $('.modal-actions').prepend(deleteBtn);
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
/* ---------- Notificaciones (campanita) ---------- */
async function refreshNotifBadge(){
  try{
    const {count}=await api('/notifications/unread-count');
    notifUnreadCount=count;
    const bell=document.getElementById('notif-bell');
    if(!bell)return;
    const existing=bell.querySelector('.bell-badge');
    if(count>0){
      const text=count>99?'99+':String(count);
      if(existing)existing.textContent=text;
      else bell.insertAdjacentHTML('beforeend',`<span class="bell-badge">${text}</span>`);
    }else if(existing){existing.remove();}
  }catch{ /* un poll fallido no debe molestar */ }
}
async function toggleNotifPanel(){
  const panel=document.getElementById('notif-panel');
  if(!panel)return;
  if(!panel.classList.contains('hidden')){panel.classList.add('hidden');return;}
  panel.classList.remove('hidden');
  panel.innerHTML='<div class="empty" style="padding:16px">Cargando…</div>';
  let data;
  try{data=await api('/notifications');}
  catch(err){panel.innerHTML='<div class="empty" style="padding:16px">No se pudieron cargar.</div>';toast(apiErrorMessage(err));return;}
  const items=data.notifications.map(n=>`<button type="button" class="notif-item ${n.readAt?'':'unread'}" data-notif="${n.id}" data-notif-target-type="${esc(n.targetType)}" data-notif-target-id="${esc(n.targetId||'')}"><span class="notif-title">${esc(n.title)}</span><span class="notif-time">${esc(formatDateTime(n.createdAt))}</span></button>`).join('');
  panel.innerHTML=`<div class="notif-head"><strong>Notificaciones</strong>${data.unreadCount>0?`<button class="btn btn-ghost" type="button" id="notif-read-all" style="padding:4px 8px;font-size:11px">Marcar todas leídas</button>`:''}</div>${items||'<div class="empty" style="padding:16px">No tenés notificaciones.</div>'}`;
  const readAll=document.getElementById('notif-read-all');
  if(readAll)readAll.onclick=async()=>{try{await api('/notifications/read-all',{method:'POST'});}catch{ /* reintenta luego */ }toggleNotifPanel();toggleNotifPanel();refreshNotifBadge();};
  panel.querySelectorAll('[data-notif]').forEach(el=>el.onclick=()=>openNotification(el.dataset.notif,el.dataset.notifTargetType,el.dataset.notifTargetId));
}
// Al hacer click, la notificacion se marca leida y te lleva a su destino.
async function openNotification(id,targetType,targetId){
  try{await api(`/notifications/${id}/read`,{method:'POST'});}catch{ /* no bloquea la navegacion */ }
  const panel=document.getElementById('notif-panel');
  if(panel)panel.classList.add('hidden');
  refreshNotifBadge();
  if(targetType==='ticket'&&targetId){
    currentView=isStaff()?'tickets':'employee-portal';
    currentDetailId=null;
    await render();
    const ticket=store.tickets.find(t=>t.id===targetId);
    if(ticket)ticketDetail(ticket);
    else toast('Ese ticket ya no está disponible.');
    return;
  }
  if(targetType==='group'||targetType==='chat'){
    currentView='chat';
    if(targetType==='group'&&targetId)activeChatGroupId=targetId;
    render();
    return;
  }
  render();
}

/* ---------- Polling de fondo: badge de Mensajes + campanita, mismo ciclo ---------- */
function startBackgroundPolling(){
  stopChatUnreadPolling();
  refreshChatUnreadBadge();
  refreshNotifBadge();
  chatUnreadPollHandle=setInterval(()=>{refreshChatUnreadBadge();refreshNotifBadge();},CHAT_UNREAD_POLL_MS);
}
function stopChatUnreadPolling(){
  if(chatUnreadPollHandle){clearInterval(chatUnreadPollHandle);chatUnreadPollHandle=null;}
}

/* ---------- Router ---------- */
async function render(id){
  if(!session){loginView();return;}
  stopChatThreadPolling();
  // Las vistas de detalle recuerdan su registro: un re-render sin argumento
  // (tras guardar un cambio, cerrar un ticket, etc.) reusa el ultimo id.
  if(id===undefined)id=currentDetailId||undefined;
  currentDetailId=id||null;

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
      if(!id){currentView='employees';content=employeesView();break;}
      let detail;
      try{const res=await api(`/employees/${id}`);detail=normalizeEmployee(res.employee);}
      catch(err){handleApiError(err);return;}
      content=employeeDetail(detail);
      break;
    }
    case 'equipment-detail':{
      const eq=id?equipment(id):null;
      if(!eq){currentView='equipment';content=equipmentView();break;}
      content=equipmentDetail(eq);
      break;
    }
    case 'sector-detail':{
      if(!id){currentView='sectors';content=sectorsView();break;}
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
  if(currentView==='sector-detail')wireSectorCategories();
}

(async function bootstrap(){
  try{const {user}=await api('/auth/me');applySessionUser(user);}
  catch{session=false;currentUser=null;}
  render();
})();
