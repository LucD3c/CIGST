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
    disconnectRealtime();
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

/* ---------- Chat interno: estado ---------- */
// Los mensajes llegan empujados por el servidor (WebSocket, mas abajo). No hay
// intervalos preguntando "¿hay algo nuevo?": el navegador no pide nada hasta
// que el servidor le avisa.
let chatConversations = [];
let chatGroups = [];
let activeChatConversationId = null;
let activeChatGroupId = null;
let chatMessages = [];
let chatUnreadCount = 0;

/* ---------- Tiempo real (WebSocket) ---------- */
// Espera antes de reintentar cuando se corta la conexion. Arranca corta y va
// subiendo (backoff) para no castigar al servidor si lo que se cayo es el
// servidor y no la red.
const RT_RECONNECT_MIN_MS = 1000;
const RT_RECONNECT_MAX_MS = 20000;
let rtSocket = null;
let rtReconnectDelay = RT_RECONNECT_MIN_MS;
let rtReconnectHandle = null;
// Cuando el servidor cierra la conexion a proposito (cerraste sesion, te
// desactivaron) NO hay que reintentar: reconectar seria pelearle al servidor.
let rtDeliberatelyClosed = false;
// Mensajes propios mandados por socket que todavia esperan confirmacion.
const rtPendingRefs = new Set();

function rtUrl(){
  const scheme=location.protocol==='https:'?'wss:':'ws:';
  return `${scheme}//${location.host}/ws`;
}
function connectRealtime(){
  if(!session)return;
  if(rtSocket&&(rtSocket.readyState===WebSocket.OPEN||rtSocket.readyState===WebSocket.CONNECTING))return;
  rtDeliberatelyClosed=false;
  let socket;
  try{socket=new WebSocket(rtUrl());}catch{scheduleRealtimeReconnect();return;}
  rtSocket=socket;
  socket.onopen=()=>{
    rtReconnectDelay=RT_RECONNECT_MIN_MS;
    // Al reconectar (volver de suspender la notebook, recuperar el wifi) se
    // resincroniza lo que pudo pasar mientras no habia conexion.
    resyncAfterReconnect();
  };
  socket.onmessage=ev=>{
    let payload;
    try{payload=JSON.parse(ev.data);}catch{return;}
    handleRealtimeEvent(payload.event,payload.data);
  };
  socket.onclose=ev=>{
    rtSocket=null;
    // 4001 = el servidor invalido esta sesion a proposito: no se reintenta.
    if(ev.code===4001||rtDeliberatelyClosed)return;
    scheduleRealtimeReconnect();
  };
  socket.onerror=()=>{ /* el cierre lo maneja onclose */ };
}
function scheduleRealtimeReconnect(){
  if(rtReconnectHandle||rtDeliberatelyClosed||!session)return;
  rtReconnectHandle=setTimeout(()=>{
    rtReconnectHandle=null;
    connectRealtime();
    rtReconnectDelay=Math.min(rtReconnectDelay*2,RT_RECONNECT_MAX_MS);
  },rtReconnectDelay);
}
function disconnectRealtime(){
  rtDeliberatelyClosed=true;
  if(rtReconnectHandle){clearTimeout(rtReconnectHandle);rtReconnectHandle=null;}
  if(rtSocket){try{rtSocket.close(1000,'salir');}catch{ /* ya estaba cerrado */ }rtSocket=null;}
  rtPendingRefs.clear();
}
function rtSend(payload){
  if(!rtSocket||rtSocket.readyState!==WebSocket.OPEN)return false;
  try{rtSocket.send(JSON.stringify(payload));return true;}catch{return false;}
}
const rtConnected=()=>Boolean(rtSocket&&rtSocket.readyState===WebSocket.OPEN);

// Sonda de vida. Al suspender el equipo (cerrar la tapa) o perder el wifi, el
// navegador puede dejar el socket en estado "abierto" aunque ya no pase nada
// por el: readyState sigue en OPEN y los mensajes se pierden en silencio. El
// servidor lo detecta con su propio ping cada 30s, pero para que la vuelta sea
// inmediata se comprueba tambien desde aca en los dos momentos en que eso
// pasa: cuando la pestana vuelve a estar visible y cuando vuelve la red.
// No es polling: no se pide informacion, solo se pregunta "¿seguís ahí?" y
// unicamente en esos dos eventos.
const RT_PROBE_TIMEOUT_MS = 4000;
let rtProbeHandle = null;
const rtPongListeners = new Set();
function probeRealtime(){
  if(!session||rtDeliberatelyClosed)return;
  if(!rtConnected()){connectRealtime();return;}
  if(rtProbeHandle)return;
  let contesto=false;
  const alPong=()=>{contesto=true;};
  rtPongListeners.add(alPong);
  rtSend({type:'ping'});
  rtProbeHandle=setTimeout(()=>{
    rtProbeHandle=null;
    rtPongListeners.delete(alPong);
    if(contesto)return;
    // No contesto: la conexion esta muerta aunque el navegador diga que no.
    try{rtSocket&&rtSocket.close(1000,'sin-respuesta');}catch{ /* ya cerrado */ }
    rtSocket=null;
    rtReconnectDelay=RT_RECONNECT_MIN_MS;
    connectRealtime();
  },RT_PROBE_TIMEOUT_MS);
}
window.addEventListener('online',probeRealtime);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)probeRealtime();});

// Volver de una desconexion: puede haber quedado historial sin ver. Se recarga
// el hilo abierto y se refrescan los contadores, una sola vez.
async function resyncAfterReconnect(){
  if(!session)return;
  try{const{count}=await api('/chat/unread-count');applyChatUnreadCount(count);}
  catch{ /* si falla, el proximo evento lo corrige */ }
  refreshNotifBadge();
  if(currentView!=='chat')return;
  if(activeChatConversationId)openChatThread(activeChatConversationId);
  else if(activeChatGroupId)openGroupThread(activeChatGroupId);
}

function handleRealtimeEvent(event,data){
  switch(event){
    case 'ready':return;
    case 'pong':rtPongListeners.forEach(fn=>fn());return;
    case 'chat:message':return onRealtimeChatMessage(data);
    case 'chat:unread':return applyChatUnreadCount(data?.count??0);
    case 'chat:read':return onRealtimeChatRead(data);
    case 'notification:new':return applyNotifCount(data?.unreadCount??0);
    case 'ticket:created':
    case 'ticket:updated':return onRealtimeTicket(data);
    case 'chat:sent':return rtPendingRefs.delete(data?.ref);
    case 'chat:error':
      rtPendingRefs.delete(data?.ref);
      return toast(data?.message||'No se pudo enviar el mensaje.');
    case 'session:closed':
      rtDeliberatelyClosed=true;
      session=false;currentUser=null;
      disconnectRealtime();
      loginView();
      return toast(data?.reason||'Tu sesión se cerró.');
    case 'error':return toast(data?.message||'Error de conexión.');
    default:return;
  }
}

// Mensaje empujado por el servidor. Si es del hilo abierto se agrega a la
// vista; si no, solo se actualiza el resumen de la lista.
function onRealtimeChatMessage(m){
  if(!m)return;
  const delHiloAbierto=(m.conversationId&&m.conversationId===activeChatConversationId)
    ||(m.groupId&&m.groupId===activeChatGroupId);
  if(delHiloAbierto){
    if(chatMessages.some(x=>x.id===m.id))return; // ya estaba (eco propio)
    appendChatMessage(m);
    // Con el hilo a la vista, lo que llega se da por leido.
    if(!m.mine)markThreadRead(m.conversationId?{conversationId:m.conversationId}:{groupId:m.groupId});
    return;
  }
  const lista=m.groupId?chatGroups:chatConversations;
  const item=lista.find(x=>x.id===(m.groupId||m.conversationId));
  if(item){
    item.lastMessage={body:m.body,senderId:m.senderId,createdAt:m.createdAt,mine:Boolean(m.mine)};
    item.lastMessageAt=m.createdAt;
    if(!m.mine)item.unreadCount=(item.unreadCount||0)+1;
  }
  if(currentView==='chat')render();
}

function onRealtimeChatRead(data){
  if(!data?.conversationId||data.conversationId!==activeChatConversationId)return;
  const ahora=new Date().toISOString();
  chatMessages=chatMessages.map(m=>(m.mine&&!m.readAt?{...m,readAt:ahora}:m));
  const pane=document.getElementById('chat-messages');
  if(pane){pane.innerHTML=chatMessages.map(chatBubble).join('');scrollChatToBottom();}
}

// Ticket creado o modificado por otra persona. El servidor solo manda esto a
// quien tiene permiso de verlo: aca no hace falta volver a filtrar.
function onRealtimeTicket(ticket){
  if(!ticket?.id)return;
  const normalizado=normalizeTicket(ticket);
  const idx=store.tickets.findIndex(t=>t.id===ticket.id);
  if(idx>=0)store.tickets[idx]={...store.tickets[idx],...normalizado};
  else store.tickets.unshift(normalizado);
  if(['tickets','dashboard','employee-portal'].includes(currentView)){
    if(document.getElementById('tickets-table'))refreshList('tickets');
    else render();
  }
}


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
    workStartTime: e.workStartTime || '', workEndTime: e.workEndTime || '',
    workingStatus: e.workingStatus || 'sin-horario',
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
  startRealtime();
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
function shell(content){const byId=ids=>navItems.filter(([id])=>ids.includes(id));const operacion=byId(['dashboard','tickets']);const informacion=byId(['employees','equipment','sectors']);const administracion=byId(['logbook','users']);const comunicacion=byId(['chat']);const staffNav=`<div class="nav-group">Operación</div>${operacion.map(nav).join('')}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${informacion.map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${administracion.map(nav).join('')}`:''}`;const employeeNav=`<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}`;const bellBadge=notifUnreadCount>0?`<span class="bell-badge">${notifUnreadCount>99?'99+':notifUnreadCount}</span>`:'';app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span><button class="bell" id="notif-bell" type="button" title="Notificaciones">🔔${bellBadge}</button></div><div id="notif-panel" class="notif-panel hidden"></div><nav class="nav">${isStaff()?staffNav:employeeNav}</nav><div class="sidebar-user"><strong>${esc(currentUser.name)}</strong><span>${esc(currentUser.role)}</span></div></aside><main class="main"><header class="topbar">${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions"><span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{currentView=el.dataset.view;currentDetailId=null;render();});$('#notif-bell').onclick=toggleNotifPanel;$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }session=false;currentUser=null;disconnectRealtime();chatConversations=[];chatGroups=[];activeChatConversationId=null;activeChatGroupId=null;chatMessages=[];chatUnreadCount=0;notifUnreadCount=0;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
const nav=([id,icon,label])=>{const badge=id==='chat'&&chatUnreadCount>0?`<span class="nav-badge">${chatUnreadCount>99?'99+':chatUnreadCount}</span>`:'';return `<button class="nav-item ${currentView===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;};
function keyHandler(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#global-search')?.focus();}if(e.key==='Escape'){closeModal();document.getElementById('notif-panel')?.classList.add('hidden');}}
function page(title,subtitle,button=''){return `<div class="page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`}
function dashboard(){const active=store.tickets.filter(t=>!['Resuelto','Cerrado','Cancelado'].includes(t.status));return page('Centro de operaciones','Visión general del soporte técnico.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)+`<section class="metrics"><div class="metric"><div class="metric-label">Abiertos <span>◈</span></div><div class="metric-value">${active.length}</div><div class="metric-meta">requieren seguimiento</div></div><div class="metric urgent"><div class="metric-label">Urgentes <span>!</span></div><div class="metric-value">${store.tickets.filter(t=>t.priority==='Crítica').length}</div><div class="metric-meta">prioridad crítica</div></div><div class="metric live"><div class="metric-label">En proceso <span>↗</span></div><div class="metric-value">${store.tickets.filter(t=>t.status==='En proceso').length}</div><div class="metric-meta">con técnico asignado</div></div><div class="metric"><div class="metric-label">Esperando <span>◷</span></div><div class="metric-value">${store.tickets.filter(t=>t.status.startsWith('Esperando')).length}</div><div class="metric-meta">usuario o proveedor</div></div><div class="metric"><div class="metric-label">Resueltos <span>✓</span></div><div class="metric-value">${store.tickets.filter(t=>['Resuelto','Cerrado'].includes(t.status)).length}</div><div class="metric-meta">histórico registrado</div></div></section><section class="grid"><div class="panel"><div class="panel-head"><h2>Tickets que requieren atención</h2><a data-view="tickets">Ver todos</a></div>${ticketsTable(active)}</div><div class="panel"><div class="panel-head"><h2>Actividad reciente</h2>${isAdmin()?'<a data-view="logbook">Bitácora</a>':''}</div><div class="activity">${store.activity.length?store.activity.map(activity).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'}</div></div></section><section class="two-panels"><div class="panel"><div class="panel-head"><h2>Eventos importantes</h2>${isAdmin()?'<a data-view="logbook">Ver bitácora</a>':''}</div>${isAdmin()?(store.logbook.length?store.logbook.slice(0,3).map(e=>`<div class="event"><strong>${esc(e.title)}</strong><span>${esc(e.category)} · ${e.date} · ${esc(e.author)}</span></div>`).join(''):'<div class="empty">No hay eventos técnicos registrados.</div>'):'<div class="empty">Solo visible para Administrador.</div>'}</div><div class="panel"><div class="panel-head"><h2>Recordatorios</h2></div><div class="empty">No hay recordatorios pendientes.</div></div></section>`}
/* ---------- Ordenamiento de listas por columna ---------- */
// Cada lista recuerda por que columna esta ordenada y en que sentido. Se
// hace clic en el encabezado para ordenar y de nuevo para invertir.
const sortState = {};
const PRIORITY_RANK = { 'Crítica':0, 'Alta':1, 'Media':2, 'Baja':3 };
const STATUS_RANK = { 'Nuevo':0, 'Abierto':1, 'En proceso':2, 'Esperando usuario':3, 'Esperando proveedor':4, 'Resuelto':5, 'Cerrado':6, 'Cancelado':7 };
// Valor por el que se compara cada columna (algunas no se ordenan alfabetico:
// prioridad y estado siguen su orden logico, no el del abecedario).
function sortValue(kind,col,row){
  if(kind==='tickets'){
    if(col==='priority')return PRIORITY_RANK[row.priority]??99;
    if(col==='status')return STATUS_RANK[row.status]??99;
    if(col==='person')return row.employeeInfo?.name||employee(row.employee)?.name||'';
    if(col==='technician')return row.technician||'zzz';
  }
  if(kind==='users'&&col==='lastAccess')return row.lastAccessAt||'';
  // Se ordena por el texto que se ve en la celda: si la fila muestra "Sin
  // sector", tiene que ordenarse como "Sin sector" y no como celda vacia
  // (que se iria toda junta al principio y pareceria desordenado).
  if(col==='sectorName')return row.sectorName||'Sin sector';
  const v=row[col];
  if(typeof v==='number')return v;
  return String(v??'');
}
// Comparador de textos con criterio español: ignora mayusculas y acentos
// ("Ávila" va junto a "Ana", no despues de "Zulema") y compara los numeros
// por valor ("Consultorio 3" antes que "Consultorio 213"). Comparar con < y >
// usaria el codigo del caracter, que para nombres reales se ve desordenado.
const textCompare=new Intl.Collator('es',{sensitivity:'base',numeric:true}).compare;
function sortRows(kind,rows){
  const s=sortState[kind];
  if(!s||!s.col)return rows;
  return [...rows].sort((a,b)=>{
    const va=sortValue(kind,s.col,a),vb=sortValue(kind,s.col,b);
    const d=(typeof va==='number'&&typeof vb==='number')?va-vb:textCompare(String(va),String(vb));
    return d*s.dir;
  });
}
// Encabezado clickeable con la flecha del sentido actual.
function sortableTh(kind,col,label,extra=''){
  const s=sortState[kind];
  const active=s&&s.col===col;
  const arrow=active?(s.dir===1?' ▲':' ▼'):'';
  return `<th class="sortable ${active?'sorted':''}" data-sort-kind="${kind}" data-sort-col="${col}" ${extra} title="Ordenar por ${esc(label)}">${esc(label)}${arrow}</th>`;
}
function wireSorting(root=document){
  root.querySelectorAll('[data-sort-col]').forEach(th=>th.onclick=()=>{
    const kind=th.dataset.sortKind,col=th.dataset.sortCol;
    const s=sortState[kind];
    sortState[kind]=(s&&s.col===col)?{col,dir:s.dir*-1}:{col,dir:1};
    refreshList(kind);
  });
}

function ticketsTable(rows){const showActions=isStaff();return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('tickets','code','Ticket')}${sortableTh('tickets','title','Incidencia')}${sortableTh('tickets','person','Persona')}${sortableTh('tickets','priority','Prioridad')}${sortableTh('tickets','status','Estado')}${sortableTh('tickets','technician','Asignado')}${showActions?'<th></th>':''}</tr></thead><tbody>${sortRows('tickets',rows).map(t=>`<tr data-ticket="${t.id}"><td class="mono">${esc(t.code)}</td><td><strong>${esc(t.title)}</strong></td><td>${esc(t.employeeInfo?.name||employee(t.employee)?.name||'Sin persona')}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${esc(t.technician||'Sin asignar')}</td>${showActions?`<td class="row-actions"><button class="btn-icon" type="button" data-quick-menu="${t.id}" title="Acciones rápidas">⋮</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${showActions?7:6}" class="empty">No hay tickets en esta vista.</td></tr>`}</tbody></table></div>`}
const activity=a=>`<div class="activity-item"><div class="activity-symbol">${a.icon}</div><div class="activity-copy">${a.text}</div><div class="activity-time">${a.time}</div></div>`;
// Filtro de estado de los tickets. Por defecto oculta los cerrados y
// cancelados: en el dia a dia lo que importa es lo que sigue abierto.
let ticketStatusFilter = 'activos';
const TICKET_STATUS_OPTIONS = [
  ['activos','Sin cerrados ni cancelados'],
  ['todos','Todos los estados'],
  ['Nuevo','Nuevo'],['Abierto','Abierto'],['En proceso','En proceso'],
  ['Esperando usuario','Esperando usuario'],['Esperando proveedor','Esperando proveedor'],
  ['Resuelto','Resuelto'],['Cerrado','Cerrado'],['Cancelado','Cancelado'],
];
function ticketsMatchingStatus(rows){
  if(ticketStatusFilter==='todos')return rows;
  if(ticketStatusFilter==='activos')return rows.filter(t=>!['Cerrado','Cancelado'].includes(t.status));
  return rows.filter(t=>t.status===ticketStatusFilter);
}
function ticketsView(){
  const opts=TICKET_STATUS_OPTIONS.map(([v,l])=>`<option value="${esc(v)}"${v===ticketStatusFilter?' selected':''}>${esc(l)}</option>`).join('');
  const visibles=ticketsMatchingStatus(store.tickets).length;
  return page('Tickets','Registro y seguimiento de pedidos.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)
    +`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, persona o número…" data-filter="tickets" />`
    +`<select class="list-select" id="ticket-status-filter" title="Filtrar por estado">${opts}</select>`
    +`<span class="list-count">${visibles} de ${store.tickets.length}</span></div>`
    +`<div class="panel" id="tickets-table">${ticketsTable(ticketsMatchingStatus(store.tickets))}</div>`;
}
function employeePortal(){const person=employee(currentUser.employeeId);return page('Solicitudes de soporte','Creá una solicitud para vos o para cualquier persona de la empresa.',`<button class="btn btn-primary" data-action="new-employee-ticket">+ Solicitar soporte</button>`)+`<section class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><span class="muted">${esc(person?.sectorName||'')}</span></div>${ticketsTable(store.tickets)}</section><section class="panel" style="margin-top:18px"><div class="side-card"><h3>¿Necesitás ayuda?</h3><p class="muted">Describí el problema, elegí a quién hay que asistir (vos u otra persona), la prioridad y, si corresponde, el equipo. Sistemas recibirá la solicitud y actualizará el estado.</p></div></section>`}
function employeesView(){return page('Personas','Ficha centralizada de colaboradores y su contexto técnico.',isAdmin()?`<button class="btn btn-primary" data-action="new-employee">+ Nueva persona</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, correo, interno o sector…" data-filter="employees" /></div><div class="panel" id="employees-table">${employeesTable(store.employees)}</div>`}
// Indicador de disponibilidad segun el horario laboral cargado. Lo calcula el
// servidor con la hora de la empresa, asi todos ven lo mismo.
function workingBadge(x){
  if(x.workingStatus==='en-linea')return `<span class="badge b-green">En línea</span>`;
  if(x.workingStatus==='fuera-de-horario')return `<span class="badge b-gray">Fuera de horario</span>`;
  return `<span class="muted" style="font-size:11px">Sin horario</span>`;
}
function workingRange(x){
  return x.workStartTime&&x.workEndTime?`${x.workStartTime}–${x.workEndTime}`:'';
}
function employeesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('employees','name','Persona')}${sortableTh('employees','sectorName','Sector')}${sortableTh('employees','position','Cargo')}${sortableTh('employees','workStartTime','Horario')}${sortableTh('employees','workingStatus','Disponibilidad')}${sortableTh('employees','status','Estado')}</tr></thead><tbody>${sortRows('employees',rows).map(x=>`<tr data-employee="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.sectorName||'Sin sector')}</td><td>${esc(x.position)}</td><td class="mono">${esc(workingRange(x)||x.workShift||'—')}</td><td>${workingBadge(x)}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">No se encontraron personas.</td></tr>`}</tbody></table></div>`}
function equipmentView(){return page('Equipos y espacios','Todo aquello sobre lo que se puede pedir ayuda: equipos, consultorios, salas, instalaciones.',isAdmin()?`<button class="btn btn-primary" data-action="new-equipment">+ Nuevo equipo o espacio</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por tipo, nombre o sector…" data-filter="equipment" /></div><div class="panel" id="equipment-table">${equipmentTable(store.equipment)}</div>`}
function equipmentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('equipment','model','Equipo o espacio')}${sortableTh('equipment','type','Tipo')}${sortableTh('equipment','sectorName','Sector')}${sortableTh('equipment','status','Estado')}</tr></thead><tbody>${sortRows('equipment',rows).map(x=>`<tr data-equipment="${x.id}"><td><strong>${esc(x.model)||esc(x.type)}</strong><br><span class="muted mono">${esc(x.code)}</span></td><td>${esc(x.type)}</td><td>${esc(x.sectorName||'Sin sector')}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="4" class="empty">No se encontraron equipos ni espacios.</td></tr>`}</tbody></table></div>`}
function logbookView(){return page('Bitácora técnica','Eventos relevantes y cambios de infraestructura.',`<button class="btn btn-primary" data-action="new-log">+ Registrar evento</button>`)+`<section class="panel">${store.logbook.map(x=>`<div class="event"><div class="row-between"><strong>${esc(x.title)}</strong>${badge(x.category)}</div><span>${x.date} · ${esc(x.author)}</span><p class="muted">${esc(x.detail)}</p></div>`).join('')}</section>`}
function usersTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('users','name','Usuario')}${sortableTh('users','role','Rol')}${sortableTh('users','status','Estado')}${sortableTh('users','lastAccess','Último acceso')}${sortableTh('users','logins','Ingresos')}</tr></thead><tbody>${sortRows('users',rows).map(x=>`<tr data-user="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="mono">${esc(x.username)}</span></td><td>${esc(x.role)}</td><td>${badge(x.status)}</td><td>${esc(x.lastAccess)}</td><td>${x.logins}</td></tr>`).join('')||`<tr><td colspan="5" class="empty">No hay usuarios.</td></tr>`}</tbody></table></div>`}
function usersView(){return page('Panel administrador','Usuarios, roles y accesos de la plataforma.',`<button class="btn btn-primary" data-action="new-user">+ Crear usuario</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, usuario o rol…" data-filter="users" /><span class="list-count">${store.users.length} usuarios</span></div><section class="panel" id="users-table">${usersTable(store.users)}</section>`}
function employeeDetail(x){const relatedTickets=store.tickets.filter(t=>t.employee===x.id);return page('Ficha de persona','Contexto operativo unificado.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-employee="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.name)}</h2><p>${esc(x.position)} · ${esc(x.sectorName||'Sin sector')}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Correo</label>${esc(x.email)}</div><div class="info"><label>Interno</label>${esc(x.extension)}</div><div class="info"><label>Horario laboral</label>${esc(workingRange(x)||x.workShift||'No definido')} ${workingBadge(x)}</div><div class="info"><label>Reemplazo</label>${esc(x.replacementInfo?.name||'No definido')}</div></div></div><div class="panel-head"><h2>Tickets relacionados</h2></div>${ticketsTable(relatedTickets)}</section><aside><div class="panel side-card"><h3>Equipamiento del sector</h3>${x.sectorEquipment.map(e=>`<div class="event linkable" data-equipment="${e.id}"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">No hay equipamiento registrado en este sector.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Notas técnicas</h3>${x.notes?`<div class="note">${esc(x.notes)}</div>`:'<p class="muted">Sin observaciones registradas.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía.</p>'}</div></aside></div>`}
function equipmentDetail(x){const tickets=store.tickets.filter(t=>t.equipment===x.id);return page('Detalle de equipamiento','Información, historial de cambios y tickets asociados.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-equipment="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.model)||esc(x.type)}</h2><p>${esc(x.type)} · ${esc(x.code)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Sector</label>${esc(x.sectorName||'Sin asignar')}</div></div></div><div class="panel-head"><h2>Tickets asociados</h2></div>${ticketsTable(tickets)}</section><aside><div class="panel side-card"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía. Cada edición del equipo deja acá su historial automático.</p>'}</div></aside></div>`}
function sectorsView(){return page('Sectores y turnos','Catálogo compartido por Personas, Equipos y Tickets.',isAdmin()?`<button class="btn btn-primary" data-action="new-sector">+ Nuevo sector</button>`:'')+`<div class="panel" id="sectors-table">${sectorsTable(store.sectors)}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Turnos de soporte</h2>${isAdmin()?'<button class="btn btn-ghost" data-action="new-schedule">+ Nuevo turno</button>':''}</div><div id="schedules-table">${schedulesTable(store.schedules)}</div></section>`}
function sectorsTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('sectors','name','Sector')}${sortableTh('sectors','status','Estado')}</tr></thead><tbody>${sortRows('sectors',rows).map(s=>`<tr data-sector="${s.id}"><td><strong>${esc(s.name)}</strong></td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay sectores creados todavía.</td></tr>`}</tbody></table></div>`}
function schedulesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('schedules','name','Turno')}${sortableTh('schedules','startTime','Horario')}${sortableTh('schedules','status','Estado')}</tr></thead><tbody>${sortRows('schedules',rows).map(s=>`<tr data-schedule="${s.id}"><td><strong>${esc(s.name)}</strong></td><td class="mono">${esc(s.startTime)}–${esc(s.endTime)}</td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No hay turnos creados todavía.</td></tr>`}</tbody></table></div>`}
function sectorDetail(x){
  const peopleRows=[...x.people].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}))
    .map(p=>`<tr data-employee="${p.id}"><td>${esc(p.name)}</td><td>${badge(p.status)}</td></tr>`).join('')
    ||`<tr><td colspan="2" class="empty">No hay personas en este sector.</td></tr>`;
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
    +`<div class="panel-head"><h2>Personas (${x.people.length})</h2>${isAdmin()?`<button class="btn btn-ghost" type="button" data-add-person-here="${x.id}">+ Agregar persona a este sector</button>`:''}</div><div class="table-wrap"><table class="data-table"><tbody>${peopleRows}</tbody></table></div></section>`
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
  // Alta de persona ya ubicada en este sector: evita tener que ir a Personas,
  // crearla y volver a elegir el sector a mano.
  document.querySelectorAll('[data-add-person-here]').forEach(btn=>btn.onclick=()=>openEmployeeNew(btn.dataset.addPersonHere));
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
function sectorSelectOptions(selectedId,emptyLabel='Sin definir'){
  const sorted=store.sectors.map(s=>[s.id,s.name]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'es',{sensitivity:'base'}));
  const opts=[['',emptyLabel],...sorted];
  return opts.map(([v,l])=>`<option value="${esc(v)}"${v===selectedId?' selected':''}>${esc(l)}</option>`).join('');
}
const sectorField=(selectedId='',label='Sector',emptyLabel='Sin definir')=>`<div class="field"><label>${label}</label><select name="sectorId">${sectorSelectOptions(selectedId,emptyLabel)}</select></div>`;

// Categorias del sector elegido: cada sector define las suyas desde su propia
// pantalla, asi que la lista cambia con el desplegable de Sector.
function categoriesForSector(sectorId){
  return store.categories.filter(c=>c.sectorId===sectorId).map(c=>c.name)
    .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
}
function categoryOptionsHtml(sectorId){
  const names=categoriesForSector(sectorId);
  if(!names.length)return `<option value="">${esc(sectorId?'Este sector no tiene categorías cargadas':'Elegí primero el sector a requerir')}</option>`;
  return names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
}
const byName=(a,b)=>String(a[1]).localeCompare(String(b[1]),'es',{sensitivity:'base'});
function ticketFields(defaultPersonId=''){
  const equipmentOptions=[['','No corresponde'],...store.equipment.map(x=>[x.id,`${x.model||x.type} · ${x.type}`]).sort(byName)];
  // Recien instalada la plataforma todavia no hay personas cargadas: en vez de
  // un desplegable vacio (que parece roto) se dice que falta cargarlas. El
  // ticket igual se puede crear: la persona es opcional.
  const peopleOptions=store.employees.length
    ? store.employees.map(x=>[x.id,`${x.name} · ${x.sectorName||'Sin sector'}`]).sort(byName)
    : [['','Todavía no hay personas cargadas']];
  const scheduleOptions=[['','No indicado'],...store.schedules.map(s=>[s.id,`${s.name} · ${s.startTime}–${s.endTime}`]).sort(byName)];
  const personId=defaultPersonId||peopleOptions[0]?.[0]||'';
  // El sector del ticket es el SECTOR A REQUERIR: a que area se le pide
  // ayuda. Arranca vacio a proposito y NO se deduce de la persona ni del
  // equipo — una persona de Administracion puede pedirle a Mantenimiento por
  // un equipo que esta en Deposito.
  return select('employee','Persona a asistir',peopleOptions,personId)
    +select('requestedBy','Solicitud informada por',peopleOptions,personId)
    +field('title','Título breve','text','form-span')
    +select('equipment','Equipo o espacio relacionado',equipmentOptions)
    +sectorField('','Sector a requerir','Elegí a qué sector se lo pedís')
    +`<div class="field"><label>Categoría</label><select name="category">${categoryOptionsHtml('')}</select></div>`
    +select('priority','Prioridad',['Media','Baja','Alta','Crítica'])
    +select('scheduleId','Turno de soporte',scheduleOptions)
    +requiredTextArea('description','Descripción del inconveniente','form-span')
    +attachmentField('ticket-attach');
}
async function createTicket(values,attachIds){const payload={title:values.get('title'),description:values.get('description'),employeeId:values.get('employee')||'',requestedById:values.get('requestedBy')||'',equipmentId:values.get('equipment')||'',sectorId:values.get('sectorId')||'',scheduleId:values.get('scheduleId')||'',category:values.get('category')||'',priority:values.get('priority'),attachmentIds:attachIds||[]};const {ticket}=await api('/tickets',{method:'POST',body:payload});store.tickets.unshift(normalizeTicket(ticket));}
// Al elegir el SECTOR A REQUERIR, la lista de categorias se rearma con las
// que definio ese sector. El sector ya no se deduce del equipo ni de la
// persona: son cosas distintas (donde esta el equipo vs. a quien le pido
// ayuda), y mezclarlas ofrecia categorias que no correspondian.
function wireTicketFormAutoselect(){
  const form=$('#entry-form');
  if(!form)return;
  const sectorSel=form.elements.sectorId;
  const catSel=form.elements.category;
  const refreshCategories=()=>{ if(catSel&&sectorSel)catSel.innerHTML=categoryOptionsHtml(sectorSel.value); };
  sectorSel?.addEventListener('change',refreshCategories);
  refreshCategories();
}
function openNew(kind){
 if(kind==='ticket'){let att;modal('Nuevo ticket',ticketFields(''),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee-ticket'){let att;modal('Solicitar soporte',ticketFields(currentUser.employeeId),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee')openEmployeeNew();
 if(kind==='equipment')modal('Nuevo equipo o espacio',select('type','Tipo',EQUIPMENT_TYPES)+field('model','Nombre o identificación')+sectorField(),async f=>{const payload={type:f.get('type'),model:f.get('model'),sectorId:f.get('sectorId')||''};const {equipment:created}=await api('/equipment',{method:'POST',body:payload});store.equipment.push(normalizeEquipment(created));});
 if(kind==='log')modal('Registrar evento',field('title','Título','text','form-span')+select('category','Categoría',['Mantenimiento','Infraestructura','Seguridad','Cambio','Actualización'])+field('detail','Detalle técnico','textarea','form-span'),async f=>{const payload={title:f.get('title'),category:f.get('category'),detail:f.get('detail')};const {entry}=await api('/logbook',{method:'POST',body:payload});store.logbook.unshift(normalizeLogbookEntry(entry));});
 if(kind==='user')modal('Crear usuario',field('name','Nombre completo')+field('username','Usuario')+field('password','Contraseña inicial','password')+select('role','Rol',['Administrador','Supervisor','User'])+select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name])]),async f=>{const payload={name:f.get('name'),username:f.get('username'),password:f.get('password'),role:f.get('role'),employeeId:f.get('role')==='User'?(f.get('employee')||''):''};const {user:created}=await api('/users',{method:'POST',body:payload});store.users.push(normalizeUser(created));});
 if(kind==='sector')modal('Nuevo sector',field('name','Nombre del sector'),async f=>{const {sector:created}=await api('/sectors',{method:'POST',body:{name:f.get('name')}});store.sectors.push(normalizeSector(created));});
 if(kind==='schedule')modal('Nuevo turno',field('name','Nombre del turno')+textValue('startTime','Inicio (HH:MM)','')+textValue('endTime','Fin (HH:MM)',''),async f=>{const {schedule:created}=await api('/schedules',{method:'POST',body:{name:f.get('name'),startTime:f.get('startTime'),endTime:f.get('endTime')}});store.schedules.push(normalizeSchedule(created));});
}

/* ---------- Personas y Equipos: alta, edicion y baja (solo Admin) ---------- */
// Campos de hora reales (no texto libre): con esto la plataforma calcula sola
// si la persona esta dentro de su horario ahora mismo.
const timeField=(name,label,value='')=>`<div class="field"><label>${label}</label><input name="${name}" type="time" value="${esc(value||'')}" /></div>`;
const peopleOptionsSorted=(excludeId='')=>store.employees.filter(x=>x.id!==excludeId).map(x=>[x.id,x.name]).sort(byName);

function employeeFormFields(x={}){
  return textValue('name','Nombre y apellido',x.name||'')
    +sectorField(x.sectorId||'','Sector al que pertenece')
    +textValue('position','Cargo',x.position||'')
    +textValue('email','Correo',x.email==='—'?'':(x.email||''))
    +textValue('extension','Interno',x.extension||'')
    +textValue('phone','Teléfono',x.phone||'')
    +timeField('workStartTime','Entrada (horario laboral)',x.workStartTime)
    +timeField('workEndTime','Salida (horario laboral)',x.workEndTime)
    +select('workShift','Turno laboral',['Mañana','Tarde','Jornada completa','Otro'],x.workShift)
    +select('replacement','Reemplazo habitual',[['','No definido'],...peopleOptionsSorted(x.id||'')],x.replacement||'')
    +(x.id?select('status','Estado',['Activo','Inactivo'],x.status):'')
    +`<div class="field form-span"><label>Observaciones</label><textarea name="notes">${esc(x.notes||'')}</textarea></div>`;
}
function employeePayload(f){
  return {
    name:f.get('name'),
    sectorId:f.get('sectorId')||'',
    position:f.get('position')||'',
    email:f.get('email')||'',
    extension:f.get('extension')||'',
    phone:f.get('phone')||'',
    workStartTime:f.get('workStartTime')||'',
    workEndTime:f.get('workEndTime')||'',
    workShift:f.get('workShift')||'',
    replacementId:f.get('replacement')||'',
    notes:f.get('notes')||'',
  };
}
// Los textValue son required por defecto; estos son opcionales.
function relaxOptionalFields(){
  ['email','position','extension','phone'].forEach(n=>{const el=$('#entry-form')?.elements[n];if(el)el.required=false;});
}
// defaultSectorId permite dar de alta una persona ya ubicada en un sector,
// desde la pantalla de ese sector.
function openEmployeeNew(defaultSectorId=''){
  modal('Nueva persona',employeeFormFields({sectorId:defaultSectorId}),async f=>{
    const {employee:created}=await api('/employees',{method:'POST',body:employeePayload(f)});
    store.employees.push(normalizeEmployee(created));
  });
  relaxOptionalFields();
}
function openEmployeeEdit(id){
  const x=store.employees.find(e=>e.id===id);
  if(!x)return;
  modal(`Editar ${x.name}`,employeeFormFields(x),async f=>{
    const payload={...employeePayload(f),status:f.get('status')};
    const {employee:updated}=await api(`/employees/${x.id}`,{method:'PATCH',body:payload});
    const idx=store.employees.findIndex(e=>e.id===x.id);
    if(idx>=0)store.employees[idx]=normalizeEmployee(updated);
  });
  relaxOptionalFields();
  addDeleteButton(`¿Eliminar a ${x.name}? Sus tickets se conservan, pero deja de aparecer en los listados.`,
    `/employees/${x.id}`,'Persona eliminada.','employees');
}
function openEquipmentEdit(id){
  const x=equipment(id);
  if(!x)return;
  const fields=select('type','Tipo',EQUIPMENT_TYPES,x.type)
    +textValue('model','Nombre o identificación',x.model)
    +sectorField(x.sectorId,'Sector donde está')
    +select('status','Estado',['Activo','Inactivo'],x.status);
  modal(`Editar ${x.model||x.type}`,fields,async f=>{
    const payload={type:f.get('type'),model:f.get('model'),sectorId:f.get('sectorId')||'',status:f.get('status')};
    const {equipment:updated}=await api(`/equipment/${x.id}`,{method:'PATCH',body:payload});
    const idx=store.equipment.findIndex(e=>e.id===x.id);
    if(idx>=0)store.equipment[idx]=normalizeEquipment(updated);
  });
  addDeleteButton(`¿Eliminar "${x.model||x.type}"? Los tickets que lo mencionan se conservan.`,
    `/equipment/${x.id}`,'Equipo o espacio eliminado.','equipment');
}
// Boton rojo de eliminar dentro de un modal ya abierto (solo Admin).
function addDeleteButton(confirmText,endpoint,okMessage,backToView){
  if(!isAdmin())return;
  const actions=$('.modal-actions');
  if(!actions)return;
  const btn=document.createElement('button');
  btn.type='button';btn.className='btn btn-danger';btn.textContent='Eliminar';
  btn.onclick=async()=>{
    if(!window.confirm(confirmText))return;
    try{
      await api(endpoint,{method:'DELETE'});
      closeModal();
      toast(okMessage);
      if(backToView&&currentView.endsWith('-detail')){currentView=backToView;currentDetailId=null;}
      render();
    }catch(err){toast(apiErrorMessage(err));}
  };
  actions.prepend(btn);
}

/* ---------- Panel administrador: editar/eliminar usuarios ---------- */
function openUserEdit(id){
  const u=store.users.find(x=>x.id===id);
  if(!u)return;
  const isSelf=currentUser.id===id;
  const fields=textValue('name','Nombre completo',u.name)
    +select('role','Rol',['Administrador','Supervisor','User'])
    +select('employee','Persona vinculada',[['','No aplica'],...store.employees.map(x=>[x.id,x.name]).sort(byName)])
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
// Texto escrito en cada filtro, para no perderlo al reordenar la lista.
const listFilters = { tickets:'', employees:'', equipment:'', users:'' };
// Todas las tablas que se redibujan solas al ordenar o filtrar. Si una tabla
// falta en este mapa, el encabezado se puede clickear pero la lista no se
// vuelve a dibujar: el orden cambia por dentro y no se ve.
const tableRenderers = { tickets:ticketsTable, employees:employeesTable, equipment:equipmentTable, users:usersTable, sectors:sectorsTable, schedules:schedulesTable };

// Filas visibles de una lista: filtro de texto + (en tickets) filtro de estado.
function visibleRows(kind){
  let rows=store[kind]||[];
  if(kind==='tickets')rows=ticketsMatchingStatus(rows);
  const q=(listFilters[kind]||'').toLowerCase().trim();
  if(q)rows=rows.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q));
  return rows;
}
// Vuelve a dibujar solo la tabla (sin recargar la vista entera): mantiene el
// foco en el buscador mientras se escribe.
function refreshList(kind){
  const container=document.getElementById(`${kind}-table`);
  const render=tableRenderers[kind];
  if(!container||!render)return;
  const rows=visibleRows(kind);
  container.innerHTML=render(rows);
  wireRecords(container);
  wireSorting(container);
  const count=document.querySelector('.list-count');
  if(count&&kind==='tickets')count.textContent=`${rows.length} de ${store.tickets.length}`;
}
function wirePage(){
  document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>openNew(x.dataset.action.replace('new-','')));
  document.querySelectorAll('.filter').forEach(input=>{
    const kind=input.dataset.filter;
    input.value=listFilters[kind]||'';
    input.oninput=()=>{listFilters[kind]=input.value;refreshList(kind);};
  });
  const statusFilter=document.getElementById('ticket-status-filter');
  if(statusFilter)statusFilter.onchange=()=>{ticketStatusFilter=statusFilter.value;refreshList('tickets');};
  wireRecords();
  wireSorting();
}

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
  markThreadRead({conversationId});
  if(conv)conv.unreadCount=0;
}
async function openGroupThread(groupId){
  activeChatGroupId=groupId;
  activeChatConversationId=null;
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
  markThreadRead({groupId});
  if(group)group.unreadCount=0;
}
function openNewThreadComposer(recipientId,recipientName){
  activeChatConversationId=null;
  activeChatGroupId=null;
  chatMessages=[];
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
        // Por socket si esta abierto: un solo viaje y la burbuja aparece en
        // las dos pantallas al mismo tiempo. Si justo esta reconectando, se
        // manda por HTTP para no perder el mensaje.
        const ref=`m${Date.now()}${Math.random().toString(36).slice(2,7)}`;
        const porSocket=rtSend({type:'chat:send',...target,body,attachmentIds,ref});
        if(porSocket){
          rtPendingRefs.add(ref);
          // Si el socket quedo zombie, el mensaje se perderia en silencio.
          // Al no llegar la confirmacion a tiempo se reenvia por HTTP y se
          // fuerza la reconexion.
          setTimeout(async()=>{
            if(!rtPendingRefs.has(ref))return;
            rtPendingRefs.delete(ref);
            probeRealtime();
            try{
              const {message}=await api(chatMessagesEndpoint(target),{method:'POST',body:{body,attachmentIds}});
              if(!chatMessages.some(x=>x.id===message.id))appendChatMessage(message);
            }catch(err){toast(apiErrorMessage(err));}
          },RT_PROBE_TIMEOUT_MS);
        }else{
          const {message}=await api(chatMessagesEndpoint(target),{method:'POST',body:{body,attachmentIds}});
          appendChatMessage(message);
        }
      }else{
        // La primera vez hay que crear la conversacion: eso sigue siendo un
        // POST (devuelve el id que despues usa el socket).
        const {conversation,message}=await api('/chat/conversations',{method:'POST',body:{recipientId:target.pendingRecipientId,body,attachmentIds}});
        activeChatConversationId=conversation.id;
        // Reasigna el target capturado por este mismo closure: el segundo
        // mensaje en adelante ya usa el conversationId real, sin re-wirear el form.
        target={conversationId:conversation.id};
        appendChatMessage(message);
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
// Marca el hilo como leido. Va por el socket si esta abierto (sin pedido HTTP)
// y cae al endpoint de siempre si justo esta reconectando.
function markThreadRead(target){
  if(rtSend({type:'chat:read',...target}))return;
  const endpoint=target.groupId?`/chat/groups/${target.groupId}/read`:`/chat/conversations/${target.conversationId}/read`;
  api(endpoint,{method:'POST'}).catch(()=>{ /* se reintenta al reabrir el hilo */ });
}

/* ---------- Grupos: alta y edicion (solo Admin) ---------- */
function groupMemberCheckboxes(users,selectedIds){
  const sel=new Set(selectedIds||[]);
  // Ordenados por nombre y con el sector de cada uno: al armar un grupo hay
  // que poder ver de que area es cada persona sin tener que salir a buscarlo.
  const rows=[...users].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}))
    .map(u=>`<label class="member-item"><input type="checkbox" name="memberIds" value="${esc(u.id)}"${sel.has(u.id)?' checked':''}/><span class="member-name">${esc(u.name)}</span>${u.sectorName?`<span class="member-sector">${esc(u.sectorName)}</span>`:''}<span class="member-role">${esc(u.role)}</span></label>`).join('');
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
// El contador lo manda el servidor; aca solo se pinta.
function applyChatUnreadCount(count){
  {
    chatUnreadCount=count;
    document.querySelectorAll('.nav-item[data-view="chat"]').forEach(el=>{
      const existing=el.querySelector('.nav-badge');
      if(count>0){
        const text=count>99?'99+':String(count);
        if(existing)existing.textContent=text;
        else el.insertAdjacentHTML('beforeend',`<span class="nav-badge">${text}</span>`);
      }else if(existing){existing.remove();}
    });
  }
}
/* ---------- Notificaciones (campanita) ---------- */
// Pinta el numero de la campanita. Lo empuja el servidor con cada
// notificacion nueva; el pedido HTTP queda solo para el arranque y para
// resincronizar despues de una desconexion.
function applyNotifCount(count){
  {
    notifUnreadCount=count;
    const bell=document.getElementById('notif-bell');
    if(!bell)return;
    const existing=bell.querySelector('.bell-badge');
    if(count>0){
      const text=count>99?'99+':String(count);
      if(existing)existing.textContent=text;
      else bell.insertAdjacentHTML('beforeend',`<span class="bell-badge">${text}</span>`);
    }else if(existing){existing.remove();}
  }
}
async function refreshNotifBadge(){
  try{const{count}=await api('/notifications/unread-count');applyNotifCount(count);}
  catch{ /* si falla, la proxima notificacion trae el numero al dia */ }
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

/* ---------- Arranque del tiempo real ---------- */
// Una sola conexion abierta mientras dura la sesion. Los contadores se piden
// una vez al entrar; despues los actualiza el servidor cuando cambian.
function startRealtime(){
  connectRealtime();
  api('/chat/unread-count').then(({count})=>applyChatUnreadCount(count)).catch(()=>{});
  refreshNotifBadge();
}

/* ---------- Router ---------- */
async function render(id){
  if(!session){loginView();return;}
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
