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
    case 'feed:post':return onRealtimeFeedPost(data);
    case 'feed:post-removed':return onRealtimeFeedRemoved(data);
    case 'feed:comment':return onRealtimeFeedComment(data);
    case 'feed:comment-removed':return onRealtimeFeedCommentRemoved(data);
    case 'feed:reaction':return onRealtimeFeedReaction(data);
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

// Publicacion nueva o editada. El servidor solo la manda a quien puede verla.
function onRealtimeFeedPost(post){
  if(!post?.id)return;
  const idx=feedPosts.findIndex(p=>p.id===post.id);
  if(idx>=0)feedPosts[idx]={...feedPosts[idx],...post};
  else{feedPosts.unshift(post);refreshFeedBadge();}
  if(currentView==='feed')render();
}
function onRealtimeFeedRemoved(data){
  if(!data?.postId)return;
  const antes=feedPosts.length;
  feedPosts=feedPosts.filter(p=>p.id!==data.postId);
  if(currentView==='feed'&&feedPosts.length!==antes)render();
}
function onRealtimeFeedComment(c){
  if(!c?.postId)return;
  const post=feedPosts.find(p=>p.id===c.postId);
  if(post)post.commentCount=(post.commentCount||0)+1;
  if(feedComentarios.has(c.postId)){
    const lista=feedComentarios.get(c.postId);
    if(!lista.some(x=>x.id===c.id))feedComentarios.set(c.postId,[...lista,{...c,mine:c.author?.id===currentUser.id}]);
  }
  if(currentView==='feed')render();
}
function onRealtimeFeedCommentRemoved(data){
  if(!data?.postId)return;
  const post=feedPosts.find(p=>p.id===data.postId);
  if(post)post.commentCount=Math.max(0,(post.commentCount||0)-1);
  if(feedComentarios.has(data.postId)){
    feedComentarios.set(data.postId,feedComentarios.get(data.postId).filter(c=>c.id!==data.commentId));
  }
  if(currentView==='feed')render();
}
function onRealtimeFeedReaction(data){
  const post=feedPosts.find(p=>p.id===data?.postId);
  if(!post)return;
  post.reactionCount=data.count;
  if(currentView==='feed')render();
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
  currentView = 'feed';
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
/* ---------- Compresion de imagenes antes de subirlas ---------- */
// Una foto de un celular moderno pesa entre 3 y 6 MB, y para ver una impresora
// rota o una pantalla con un error no hace falta ni la decima parte de eso.
// Sin esto, unas pocas fotos por ticket llenan el disco del servidor en meses.
//
// La compresion se hace EN EL NAVEGADOR, no en el servidor. El navegador ya
// tiene la imagen decodificada para mostrar la vista previa, asi que
// reescalarla no le cuesta nada; y de este lado sobra CPU, mientras que del
// lado del servidor -que puede ser una PC de escritorio comun atendiendo a
// toda la empresa- no. Ademas viaja menos por la red y la subida es mas rapida.
//
// Efecto lateral bueno: al reencodear se pierden los metadatos EXIF, que en
// una foto de celular incluyen la ubicacion GPS de donde se saco.

// Lado mayor al que se reduce la imagen. 1600 px alcanza de sobra para leer un
// cartel de error en pantalla completa y para imprimir en A4.
const IMG_MAX_LADO = 1600;
// Calidad del reencodeado. 0.82 es el punto donde el ojo deja de notar la
// diferencia y el archivo ya bajo un orden de magnitud.
const IMG_CALIDAD = 0.82;
// Debajo de este peso Y dentro del lado maximo no hay nada que ganar.
const IMG_MIN_BYTES = 200 * 1024;
// Tipos que se reencodean. El GIF queda afuera a proposito: puede estar
// animado y el canvas se quedaria solo con el primer cuadro.
const IMG_COMPRIMIBLES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// WebP comprime bastante mejor que JPEG y lo entienden todos los navegadores
// actuales; si alguno no pudiera, se cae a JPEG solo.
let formatoSalida = null;
function detectarFormatoSalida(){
  if(formatoSalida)return formatoSalida;
  try{
    const c=document.createElement('canvas');c.width=c.height=1;
    formatoSalida=c.toDataURL('image/webp').startsWith('data:image/webp')?'image/webp':'image/jpeg';
  }catch{formatoSalida='image/jpeg';}
  return formatoSalida;
}

function cambiarExtension(nombre,mime){
  const ext=mime==='image/webp'?'.webp':'.jpg';
  const base=nombre.replace(/\.[^.]+$/,'') || 'imagen';
  return base+ext;
}

/**
 * Devuelve una version mas liviana de la imagen, o el archivo original si no
 * se puede o si comprimirlo no lo mejora. Nunca falla: ante cualquier
 * problema devuelve lo que le dieron.
 */
async function comprimirImagen(file){
  if(!IMG_COMPRIMIBLES.has(file.type))return file;
  try{
    const bitmap=await createImageBitmap(file);
    const ladoMayor=Math.max(bitmap.width,bitmap.height);
    // Se reencodea si pesa mucho O si es mas grande de lo que se va a mostrar.
    // Las dos condiciones importan: una captura de colores planos puede pesar
    // poco y medir 4000 px de ancho igual, y esos pixeles ocupan memoria del
    // navegador de quien la abre aunque el archivo sea chico.
    if(file.size<IMG_MIN_BYTES&&ladoMayor<=IMG_MAX_LADO){bitmap.close?.();return file;}
    const escala=Math.min(1,IMG_MAX_LADO/ladoMayor);
    const ancho=Math.max(1,Math.round(bitmap.width*escala));
    const alto=Math.max(1,Math.round(bitmap.height*escala));
    const canvas=document.createElement('canvas');
    canvas.width=ancho;canvas.height=alto;
    const ctx=canvas.getContext('2d');
    // Fondo blanco: un PNG con transparencia pasado a JPEG dejaria el fondo
    // negro, que es justo lo que arruina una captura de pantalla.
    const salida=detectarFormatoSalida();
    if(salida==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,ancho,alto);}
    ctx.drawImage(bitmap,0,0,ancho,alto);
    bitmap.close?.();
    const blob=await new Promise(r=>canvas.toBlob(r,salida,IMG_CALIDAD));
    if(!blob||blob.size>=file.size)return file;   // no mejoro: se deja el original
    return new File([blob],cambiarExtension(file.name,salida),{type:salida});
  }catch{
    return file;   // navegador viejo, imagen rara, memoria: se sube tal cual
  }
}

async function uploadFiles(fileList){
  let files=[...fileList];
  if(!files.length)return [];
  if(files.length>ATTACH_MAX_FILES)throw new Error(`Se pueden adjuntar hasta ${ATTACH_MAX_FILES} archivos por vez.`);

  // Se comprime ANTES de mirar el tamano: una foto de 12 MB que despues de
  // comprimir queda en 400 KB tiene que poder subirse, no ser rechazada.
  const antes=files.reduce((n,f)=>n+f.size,0);
  files=await Promise.all(files.map(comprimirImagen));
  const despues=files.reduce((n,f)=>n+f.size,0);
  if(antes-despues>512*1024){
    toast(`Imágenes optimizadas: ${formatBytes(antes)} → ${formatBytes(despues)}`);
  }

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
const navItems = [ ['feed','◎','Novedades'], ['dashboard','⌂','Centro de operaciones'], ['tickets','◈','Tickets'], ['employees','♙','Personas'], ['equipment','▣','Equipos y espacios'], ['sectors','◫','Sectores'], ['knowledge','▦','Bases de conocimiento'], ['logbook','▤','Bitácora técnica'], ['users','◉','Panel administrador'], ['chat','✉','Mensajes'] ];
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
function shell(content){const byId=ids=>navItems.filter(([id])=>ids.includes(id));const inicio=byId(['feed']);const operacion=byId(['dashboard','tickets']);const informacion=byId(['employees','equipment','sectors','knowledge']);const administracion=byId(['logbook','users']);const comunicacion=byId(['chat']);const staffNav=`<div class="nav-group">Inicio</div>${inicio.map(nav).join('')}<div class="nav-group">Operación</div>${operacion.map(nav).join('')}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${informacion.map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${administracion.map(nav).join('')}`:''}`;const employeeNav=`<div class="nav-group">Inicio</div>${inicio.map(nav).join('')}<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${nav(['knowledge','▦','Bases de conocimiento'])}`;const bellBadge=notifUnreadCount>0?`<span class="bell-badge">${notifUnreadCount>99?'99+':notifUnreadCount}</span>`:'';app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span><button class="bell" id="notif-bell" type="button" title="Notificaciones">🔔${bellBadge}</button></div><div id="notif-panel" class="notif-panel hidden"></div><nav class="nav">${isStaff()?staffNav:employeeNav}</nav><div class="sidebar-user"><strong>${esc(currentUser.name)}</strong><span>${esc(currentUser.role)}</span></div></aside><main class="main"><header class="topbar">${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions"><span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{currentView=el.dataset.view;currentDetailId=null;render();});$('#notif-bell').onclick=toggleNotifPanel;$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }session=false;currentUser=null;disconnectRealtime();feedPosts=[];feedComentarios.clear();feedAbiertos.clear();kbSpaces=[];kbSpace=null;kbArticle=null;chatConversations=[];chatGroups=[];activeChatConversationId=null;activeChatGroupId=null;chatMessages=[];chatUnreadCount=0;notifUnreadCount=0;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
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
// Ventana de solo lectura: muestra algo y se cierra. No lleva formulario, asi
// que no reusa modal(), que siempre espera un guardado.
function modalInfo(titulo,html){
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${esc(titulo)}</h2>`
    +`<button class="close" type="button">×</button></div><div class="modal-body">${html}</div></div></div>`;
  $('.close').onclick=closeModal;
  $('.modal-backdrop').onclick=e=>{if(e.target===$('.modal-backdrop'))closeModal();};
}
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
  if(targetType==='post'){
    currentView='feed';
    currentDetailId=null;
    await render();
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
  refreshFeedBadge();
}

/* ---------- Router ---------- */
async function render(id){
  if(!session){loginView();return;}
  // Las vistas de detalle recuerdan su registro: un re-render sin argumento
  // (tras guardar un cambio, cerrar un ticket, etc.) reusa el ultimo id.
  if(id===undefined)id=currentDetailId||undefined;
  currentDetailId=id||null;

  if(!isStaff()){
    // El rango User tambien entra a Novedades y a las Bases de conocimiento:
    // no son herramientas de soporte, son informacion de la empresa.
    const permitidas=['chat','feed','knowledge'];
    if(!permitidas.includes(currentView))currentView='employee-portal';
    let content;
    try{
      if(currentView==='chat'){content=await chatView();}
      else if(currentView==='feed'){await loadFeed(true);content=feedView();}
      else if(currentView==='knowledge'){if(!kbSpace)await loadKbSpaces();content=kbView();}
      else{await loadEmployeeData();content=employeePortal();}
    }catch(err){handleApiError(err);return;}
    shell(content);wirePage();
    if(currentView==='chat')wireChatView();
    if(currentView==='feed')wireFeed();
    if(currentView==='knowledge')wireKb();
    return;
  }
  if(currentView==='users'&&!isAdmin())currentView='dashboard';
  if(currentView==='logbook'&&!isAdmin())currentView='dashboard';
  try{
    if(!['chat','feed','knowledge'].includes(currentView))await loadStaffData();
    if(currentView==='feed'){await loadStaffData();await loadFeed(true);}
    if(currentView==='knowledge'&&!kbSpace)await loadKbSpaces();
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
    case 'feed':content=feedView();break;
    case 'knowledge':content=kbView();break;
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
  if(currentView==='feed')wireFeed();
  if(currentView==='knowledge')wireKb();
  if(currentView==='sector-detail')wireSectorCategories();
}

(async function bootstrap(){
  try{const {user}=await api('/auth/me');applySessionUser(user);}
  catch{session=false;currentUser=null;}
  render();
})();

/* ---------- Bloques de contenido: renderizado y edicion ---------- */
// Lo comparten el Feed y las Bases de conocimiento. El contenido NUNCA es
// HTML del usuario: son datos con estructura conocida y aca se arma el
// marcado escapando cada texto con esc(). Por eso no hay forma de inyectar
// nada desde el contenido, ni escribiendolo a mano ni pegandolo desde Excel.

const BLOQUE_ETIQUETAS = {
  titulo: 'Título',
  texto: 'Texto',
  lista: 'Lista',
  tabla: 'Tabla',
  imagen: 'Imagen',
  archivo: 'Archivo',
  aviso: 'Aviso',
  enlace: 'Enlace',
  tarjeta: 'Tarjeta de datos',
};
const BLOQUE_ICONOS = {
  titulo: 'T', texto: '¶', lista: '•', tabla: '▦', imagen: '▣',
  archivo: '⎙', aviso: '!', enlace: '↗', tarjeta: '▤',
};

function bloqueVacio(kind) {
  switch (kind) {
    case 'titulo': return { kind, data: { texto: '', nivel: 2 } };
    case 'texto': return { kind, data: { texto: '' } };
    case 'lista': return { kind, data: { items: [''], numerada: false } };
    case 'tabla': return { kind, data: { encabezados: ['', ''], filas: [['', ''], ['', '']] } };
    case 'imagen': return { kind, data: { attachmentId: '', pie: '', ancho: 'media' } };
    case 'archivo': return { kind, data: { attachmentId: '', descripcion: '' } };
    case 'aviso': return { kind, data: { texto: '', tono: 'info' } };
    case 'enlace': return { kind, data: { titulo: '', url: '', descripcion: '' } };
    case 'tarjeta': return { kind, data: { titulo: '', imagenAttachmentId: null, campos: [{ etiqueta: '', valor: '', oculto: false }], nota: '' } };
    default: return { kind: 'texto', data: { texto: '' } };
  }
}

/* ---------- Renderizado (solo lectura) ---------- */

const urlAdjunto = (id) => `/api/attachments/${encodeURIComponent(id)}`;

function renderBloque(b) {
  const d = b.data || {};
  switch (b.kind) {
    case 'titulo':
      return `<h${d.nivel === 1 ? 3 : 4} class="blk-titulo${d.nivel === 1 ? ' blk-titulo-1' : ''}">${esc(d.texto)}</h${d.nivel === 1 ? 3 : 4}>`;
    case 'texto':
      // Los saltos de linea se respetan por CSS (white-space), no metiendo <br>.
      return `<p class="blk-texto">${esc(d.texto)}</p>`;
    case 'lista': {
      const tag = d.numerada ? 'ol' : 'ul';
      return `<${tag} class="blk-lista">${(d.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
    }
    case 'tabla': {
      const enc = (d.encabezados || []).length
        ? `<thead><tr>${d.encabezados.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
        : '';
      const filas = (d.filas || []).map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="blk-tabla-wrap"><table class="blk-tabla">${enc}<tbody>${filas}</tbody></table></div>`;
    }
    case 'imagen':
      if (!d.attachmentId) return '';
      return `<figure class="blk-imagen blk-imagen-${esc(d.ancho || 'media')}">`
        + `<img src="${urlAdjunto(d.attachmentId)}" alt="${esc(d.pie || 'Imagen')}" loading="lazy" />`
        + (d.pie ? `<figcaption>${esc(d.pie)}</figcaption>` : '')
        + `</figure>`;
    case 'archivo':
      if (!d.attachmentId) return '';
      return `<a class="attach-file blk-archivo" href="${urlAdjunto(d.attachmentId)}" target="_blank" rel="noopener">`
        + `<span class="attach-file-icon">⎙</span><span class="attach-name">${esc(d.descripcion || 'Descargar archivo')}</span></a>`;
    case 'aviso':
      return `<div class="blk-aviso blk-aviso-${esc(d.tono || 'info')}">${esc(d.texto)}</div>`;
    case 'enlace':
      // El href se valido en el servidor (solo http/https), pero se vuelve a
      // comprobar aca: nunca confiar en que el dato ya vino limpio.
      if (!/^https?:\/\//i.test(d.url || '')) return `<p class="blk-texto">${esc(d.titulo)}</p>`;
      return `<a class="blk-enlace" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">`
        + `<span class="blk-enlace-icono">↗</span><span><strong>${esc(d.titulo)}</strong>`
        + (d.descripcion ? `<span class="muted">${esc(d.descripcion)}</span>` : '') + `</span></a>`;
    case 'tarjeta': {
      const logo = d.imagenAttachmentId
        ? `<div class="blk-tarjeta-logo"><img src="${urlAdjunto(d.imagenAttachmentId)}" alt="" loading="lazy" /></div>`
        : '';
      const campos = (d.campos || []).map((c) => {
        // Los valores marcados como ocultos se muestran tapados y se revelan
        // con un clic: usuarios y claves compartidas no quedan a la vista de
        // cualquiera que pase por detras de la pantalla.
        const valor = c.oculto
          ? `<button type="button" class="blk-oculto" data-revelar="${esc(c.valor)}">Mostrar</button>`
          : `<span>${esc(c.valor)}</span>`;
        return `<div class="blk-campo"><label>${esc(c.etiqueta)}</label>${valor}</div>`;
      }).join('');
      return `<div class="blk-tarjeta">${logo}<div class="blk-tarjeta-cuerpo"><h4>${esc(d.titulo)}</h4>${campos}`
        + (d.nota ? `<p class="blk-tarjeta-nota">${esc(d.nota)}</p>` : '') + `</div></div>`;
    }
    default:
      return '';
  }
}

// Las tarjetas seguidas se agrupan en una grilla, como en la captura de
// referencia: una fila de tarjetas por obra social en vez de una debajo de otra.
function renderBloques(bloques) {
  if (!bloques?.length) return '<p class="muted">Sin contenido todavía.</p>';
  const salida = [];
  let grupo = [];
  const cerrarGrupo = () => {
    if (!grupo.length) return;
    salida.push(`<div class="blk-grilla">${grupo.join('')}</div>`);
    grupo = [];
  };
  for (const b of bloques) {
    if (b.kind === 'tarjeta') { grupo.push(renderBloque(b)); continue; }
    cerrarGrupo();
    salida.push(renderBloque(b));
  }
  cerrarGrupo();
  return salida.join('');
}

// Botones "Mostrar" de los campos ocultos.
function wireBloques(root = document) {
  root.querySelectorAll('[data-revelar]').forEach((btn) => {
    btn.onclick = () => {
      const span = document.createElement('span');
      span.textContent = btn.dataset.revelar;
      span.className = 'blk-revelado';
      btn.replaceWith(span);
    };
  });
}

/* ---------- Editor ---------- */
// El editor trabaja sobre un arreglo en memoria y se vuelve a dibujar entero
// en cada cambio. A la escala de un articulo (decenas de bloques) es
// instantaneo y evita toda una clase de errores de sincronizacion entre lo
// que se ve y lo que se va a guardar.

function crearEditorBloques(contenedorId, bloquesIniciales) {
  const estado = { bloques: JSON.parse(JSON.stringify(bloquesIniciales || [])) };

  const campoTexto = (i, campo, valor, placeholder, filas) =>
    filas
      ? `<textarea class="blk-in" rows="${filas}" data-i="${i}" data-campo="${campo}" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
      : `<input class="blk-in" data-i="${i}" data-campo="${campo}" value="${esc(valor)}" placeholder="${esc(placeholder)}" />`;

  function editorDe(b, i) {
    const d = b.data;
    switch (b.kind) {
      case 'titulo':
        return campoTexto(i, 'texto', d.texto, 'Título de la sección')
          + `<label class="blk-check"><input type="checkbox" data-i="${i}" data-campo="nivel"${d.nivel === 1 ? ' checked' : ''}/> Título grande</label>`;
      case 'texto':
        return campoTexto(i, 'texto', d.texto, 'Escribí el texto…', 4);
      case 'aviso':
        return campoTexto(i, 'texto', d.texto, 'Texto del aviso…', 3)
          + `<select class="blk-in" data-i="${i}" data-campo="tono">`
          + ['info', 'atencion', 'importante'].map((t) => `<option value="${t}"${d.tono === t ? ' selected' : ''}>${t === 'info' ? 'Informativo' : t === 'atencion' ? 'Atención' : 'Importante'}</option>`).join('')
          + `</select>`;
      case 'lista':
        return `<label class="blk-check"><input type="checkbox" data-i="${i}" data-campo="numerada"${d.numerada ? ' checked' : ''}/> Numerada</label>`
          + d.items.map((it, k) => `<div class="blk-fila-item"><input class="blk-in" data-i="${i}" data-item="${k}" value="${esc(it)}" placeholder="Elemento ${k + 1}" />`
            + `<button type="button" class="blk-mini" data-quitar-item="${i}:${k}" title="Quitar">×</button></div>`).join('')
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-item="${i}">+ Agregar elemento</button>`;
      case 'tabla': {
        const cols = d.filas[0]?.length || 0;
        const enc = `<div class="blk-tabla-edit-fila">${d.encabezados.map((h, c) => `<input class="blk-in blk-celda blk-celda-enc" data-i="${i}" data-enc="${c}" value="${esc(h)}" placeholder="Columna ${c + 1}" />`).join('')}<span class="blk-mini-espacio"></span></div>`;
        const filas = d.filas.map((f, r) => `<div class="blk-tabla-edit-fila">${f.map((c, ci) => `<input class="blk-in blk-celda" data-i="${i}" data-fila="${r}" data-col="${ci}" value="${esc(c)}" />`).join('')}`
          + `<button type="button" class="blk-mini" data-quitar-fila="${i}:${r}" title="Quitar fila">×</button></div>`).join('');
        return `<p class="blk-ayuda">Podés <strong>pegar una tabla desde Excel</strong> en cualquier celda y se completa sola.</p>`
          + `<div class="blk-tabla-edit" data-tabla="${i}">${enc}${filas}</div>`
          + `<div class="blk-acciones-tabla">`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-fila="${i}">+ Fila</button>`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-col="${i}">+ Columna</button>`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-quitar-col="${i}"${cols <= 1 ? ' disabled' : ''}>− Columna</button>`
          + `</div>`;
      }
      case 'imagen':
        return (d.attachmentId
          ? `<img class="blk-preview" src="${urlAdjunto(d.attachmentId)}" alt="" />`
          : `<p class="blk-ayuda">Todavía no elegiste una imagen.</p>`)
          + `<input type="file" class="file-input" accept="image/*" data-subir-imagen="${i}" />`
          + campoTexto(i, 'pie', d.pie || '', 'Pie de imagen (opcional)')
          + `<select class="blk-in" data-i="${i}" data-campo="ancho">`
          + [['chica', 'Chica'], ['media', 'Mediana'], ['completa', 'Ancho completo']].map(([v, t]) => `<option value="${v}"${d.ancho === v ? ' selected' : ''}>${t}</option>`).join('')
          + `</select>`;
      case 'archivo':
        return (d.attachmentId ? `<p class="blk-ayuda">Archivo cargado.</p>` : `<p class="blk-ayuda">Todavía no elegiste un archivo.</p>`)
          + `<input type="file" class="file-input" data-subir-archivo="${i}" />`
          + campoTexto(i, 'descripcion', d.descripcion || '', 'Cómo se llama el archivo');
      case 'enlace':
        return campoTexto(i, 'titulo', d.titulo, 'Nombre del enlace')
          + campoTexto(i, 'url', d.url, 'https://…')
          + campoTexto(i, 'descripcion', d.descripcion || '', 'Descripción (opcional)');
      case 'tarjeta':
        return campoTexto(i, 'titulo', d.titulo, 'Nombre (por ejemplo, la obra social)')
          + (d.imagenAttachmentId ? `<img class="blk-preview blk-preview-logo" src="${urlAdjunto(d.imagenAttachmentId)}" alt="" />` : '')
          + `<input type="file" class="file-input" accept="image/*" data-subir-logo="${i}" />`
          + d.campos.map((c, k) => `<div class="blk-fila-item">`
            + `<input class="blk-in blk-in-corto" data-i="${i}" data-campo-etiqueta="${k}" value="${esc(c.etiqueta)}" placeholder="Dato" />`
            + `<input class="blk-in" data-i="${i}" data-campo-valor="${k}" value="${esc(c.valor)}" placeholder="Valor" />`
            + `<label class="blk-check blk-check-inline" title="Se muestra tapado hasta que alguien toque Mostrar"><input type="checkbox" data-i="${i}" data-campo-oculto="${k}"${c.oculto ? ' checked' : ''}/> Ocultar</label>`
            + `<button type="button" class="blk-mini" data-quitar-campo="${i}:${k}" title="Quitar">×</button></div>`).join('')
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-campo="${i}">+ Agregar dato</button>`
          + campoTexto(i, 'nota', d.nota || '', 'Nota al pie (opcional)', 2);
      default:
        return '';
    }
  }

  function pintar() {
    const cont = document.getElementById(contenedorId);
    if (!cont) return;
    const bloques = estado.bloques.map((b, i) => `<div class="blk-edit" data-bloque="${i}">`
      + `<div class="blk-edit-head"><span class="blk-edit-tipo">${BLOQUE_ICONOS[b.kind] || '•'} ${esc(BLOQUE_ETIQUETAS[b.kind] || b.kind)}</span>`
      + `<span class="blk-edit-acciones">`
      + `<button type="button" class="blk-mini" data-subir="${i}"${i === 0 ? ' disabled' : ''} title="Subir">↑</button>`
      + `<button type="button" class="blk-mini" data-bajar="${i}"${i === estado.bloques.length - 1 ? ' disabled' : ''} title="Bajar">↓</button>`
      + `<button type="button" class="blk-mini blk-mini-danger" data-eliminar="${i}" title="Eliminar bloque">×</button>`
      + `</span></div><div class="blk-edit-body">${editorDe(b, i)}</div></div>`).join('');
    const agregar = `<div class="blk-agregar"><span class="muted">Agregar:</span>`
      + Object.keys(BLOQUE_ETIQUETAS).map((k) => `<button type="button" class="btn btn-ghost blk-mini-btn" data-nuevo="${k}">${BLOQUE_ICONOS[k]} ${esc(BLOQUE_ETIQUETAS[k])}</button>`).join('')
      + `</div>`;
    cont.innerHTML = (bloques || '<p class="muted blk-vacio">Todavía no agregaste contenido. Elegí un bloque abajo para empezar.</p>') + agregar;
    conectar(cont);
  }

  function conectar(cont) {
    const b = (i) => estado.bloques[i];

    cont.querySelectorAll('[data-nuevo]').forEach((el) => el.onclick = () => {
      estado.bloques.push(bloqueVacio(el.dataset.nuevo));
      pintar();
    });
    cont.querySelectorAll('[data-eliminar]').forEach((el) => el.onclick = () => {
      estado.bloques.splice(Number(el.dataset.eliminar), 1); pintar();
    });
    cont.querySelectorAll('[data-subir]').forEach((el) => el.onclick = () => {
      const i = Number(el.dataset.subir);
      [estado.bloques[i - 1], estado.bloques[i]] = [estado.bloques[i], estado.bloques[i - 1]];
      pintar();
    });
    cont.querySelectorAll('[data-bajar]').forEach((el) => el.onclick = () => {
      const i = Number(el.dataset.bajar);
      [estado.bloques[i + 1], estado.bloques[i]] = [estado.bloques[i], estado.bloques[i + 1]];
      pintar();
    });

    // Campos simples: se escriben en el estado sin volver a pintar, para no
    // perder el foco mientras se tipea.
    cont.querySelectorAll('[data-campo]').forEach((el) => el.oninput = () => {
      const i = Number(el.dataset.i);
      const campo = el.dataset.campo;
      if (campo === 'nivel') b(i).data.nivel = el.checked ? 1 : 2;
      else if (campo === 'numerada') b(i).data.numerada = el.checked;
      else b(i).data[campo] = el.value;
    });
    cont.querySelectorAll('[data-campo]').forEach((el) => { if (el.type === 'checkbox') el.onchange = el.oninput; });

    // Lista
    cont.querySelectorAll('[data-item]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.items[Number(el.dataset.item)] = el.value;
    });
    cont.querySelectorAll('[data-agregar-item]').forEach((el) => el.onclick = () => {
      b(Number(el.dataset.agregarItem)).data.items.push(''); pintar();
    });
    cont.querySelectorAll('[data-quitar-item]').forEach((el) => el.onclick = () => {
      const [i, k] = el.dataset.quitarItem.split(':').map(Number);
      const items = b(i).data.items;
      if (items.length > 1) items.splice(k, 1);
      pintar();
    });

    // Tabla
    cont.querySelectorAll('[data-enc]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.encabezados[Number(el.dataset.enc)] = el.value;
    });
    cont.querySelectorAll('[data-fila]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.filas[Number(el.dataset.fila)][Number(el.dataset.col)] = el.value;
    });
    cont.querySelectorAll('[data-agregar-fila]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.agregarFila)).data;
      d.filas.push(new Array(d.filas[0]?.length || 1).fill(''));
      pintar();
    });
    cont.querySelectorAll('[data-quitar-fila]').forEach((el) => el.onclick = () => {
      const [i, r] = el.dataset.quitarFila.split(':').map(Number);
      const d = b(i).data;
      if (d.filas.length > 1) d.filas.splice(r, 1);
      pintar();
    });
    cont.querySelectorAll('[data-agregar-col]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.agregarCol)).data;
      d.encabezados.push('');
      d.filas.forEach((f) => f.push(''));
      pintar();
    });
    cont.querySelectorAll('[data-quitar-col]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.quitarCol)).data;
      if ((d.filas[0]?.length || 0) <= 1) return;
      d.encabezados.pop();
      d.filas.forEach((f) => f.pop());
      pintar();
    });

    // Pegar desde Excel: se lee la tabla del portapapeles y se reemplaza el
    // contenido del bloque. Del HTML que pega Excel se toman UNICAMENTE las
    // filas y las celdas: todo lo demas (estilos, scripts, imagenes) se
    // descarta, no se guarda y nunca se renderiza.
    cont.querySelectorAll('[data-tabla] input').forEach((el) => el.onpaste = (ev) => {
      const html = ev.clipboardData?.getData('text/html');
      const plano = ev.clipboardData?.getData('text/plain') || '';
      const grilla = html ? tablaDesdeHtml(html) : tablaDesdeTexto(plano);
      if (!grilla || grilla.length < 2) return; // pegado normal de una celda
      ev.preventDefault();
      const i = Number(el.closest('[data-tabla]').dataset.tabla);
      const d = b(i).data;
      d.encabezados = grilla[0];
      d.filas = grilla.slice(1);
      pintar();
      toast(`Tabla pegada: ${d.filas.length} filas y ${d.encabezados.length} columnas.`);
    });

    // Tarjeta
    cont.querySelectorAll('[data-campo-etiqueta]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoEtiqueta)].etiqueta = el.value;
    });
    cont.querySelectorAll('[data-campo-valor]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoValor)].valor = el.value;
    });
    cont.querySelectorAll('[data-campo-oculto]').forEach((el) => el.onchange = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoOculto)].oculto = el.checked;
    });
    cont.querySelectorAll('[data-agregar-campo]').forEach((el) => el.onclick = () => {
      b(Number(el.dataset.agregarCampo)).data.campos.push({ etiqueta: '', valor: '', oculto: false });
      pintar();
    });
    cont.querySelectorAll('[data-quitar-campo]').forEach((el) => el.onclick = () => {
      const [i, k] = el.dataset.quitarCampo.split(':').map(Number);
      b(i).data.campos.splice(k, 1);
      pintar();
    });

    // Subidas
    const subir = async (el, aplicar) => {
      if (!el.files?.length) return;
      el.disabled = true;
      try {
        const [subido] = await uploadFiles(el.files);
        if (subido) { aplicar(subido); pintar(); }
      } catch (err) { toast(err.message || 'No se pudo subir el archivo.'); }
      finally { el.disabled = false; el.value = ''; }
    };
    cont.querySelectorAll('[data-subir-imagen]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { b(Number(el.dataset.subirImagen)).data.attachmentId = a.id; }));
    cont.querySelectorAll('[data-subir-archivo]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { const d = b(Number(el.dataset.subirArchivo)).data; d.attachmentId = a.id; if (!d.descripcion) d.descripcion = a.originalName; }));
    cont.querySelectorAll('[data-subir-logo]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { b(Number(el.dataset.subirLogo)).data.imagenAttachmentId = a.id; }));
  }

  pintar();

  return {
    // Devuelve los bloques listos para mandar, sacando los que quedaron vacios
    // (un bloque de texto sin texto, una imagen sin imagen) para no guardar
    // basura ni chocar con la validacion del servidor.
    valor() {
      return estado.bloques
        .map((b) => {
          const d = b.data;
          if (b.kind === 'lista') return { ...b, data: { ...d, items: d.items.map((x) => x.trim()).filter(Boolean) } };
          if (b.kind === 'tabla') {
            const filas = d.filas.filter((f) => f.some((c) => String(c).trim()));
            return { ...b, data: { ...d, filas } };
          }
          if (b.kind === 'tarjeta') {
            return { ...b, data: { ...d, campos: d.campos.filter((c) => c.etiqueta.trim()) } };
          }
          return b;
        })
        .filter((b) => {
          const d = b.data;
          switch (b.kind) {
            case 'titulo': case 'texto': case 'aviso': return Boolean(String(d.texto || '').trim());
            case 'lista': return d.items.length > 0;
            case 'tabla': return d.filas.length > 0;
            case 'imagen': case 'archivo': return Boolean(d.attachmentId);
            case 'enlace': return Boolean(d.titulo.trim() && d.url.trim());
            case 'tarjeta': return Boolean(d.titulo.trim());
            default: return false;
          }
        });
    },
    vacio() { return this.valor().length === 0; },
  };
}

// De un HTML pegado se extraen SOLO filas y celdas. Se usa DOMParser, que
// construye un documento inerte: los scripts que venga trayendo el pegado no
// se ejecutan, y de todos modos solo se lee `textContent` de cada celda.
function tablaDesdeHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tabla = doc.querySelector('table');
    if (!tabla) return null;
    const filas = [...tabla.querySelectorAll('tr')]
      .map((tr) => [...tr.querySelectorAll('th,td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()))
      .filter((f) => f.length && f.some((c) => c));
    if (!filas.length) return null;
    const cols = Math.max(...filas.map((f) => f.length));
    return filas.map((f) => [...f, ...new Array(Math.max(0, cols - f.length)).fill('')].slice(0, 12)).slice(0, 200);
  } catch { return null; }
}

// Alternativa cuando el portapapeles solo trae texto: columnas separadas por
// tabulaciones, que es como copia una planilla en texto plano.
function tablaDesdeTexto(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2 || !lineas[0].includes('\t')) return null;
  const filas = lineas.map((l) => l.split('\t').map((c) => c.trim()));
  const cols = Math.max(...filas.map((f) => f.length));
  return filas.map((f) => [...f, ...new Array(Math.max(0, cols - f.length)).fill('')].slice(0, 12)).slice(0, 200);
}

/* ---------- Feed de novedades ---------- */
// Tablero de la empresa: novedades, avisos y grillas de puestos. Lo escriben
// Administradores y Supervisores; lo lee todo el personal segun a quien este
// dirigida cada publicacion.

let feedPosts = [];
let feedHasMore = false;
let feedFiltro = '';
let feedUnseen = 0;
const feedComentarios = new Map(); // postId -> comentarios ya cargados
const feedAbiertos = new Set();    // publicaciones con los comentarios a la vista

const puedePublicar = () => isStaff();

async function loadFeed(reset = true) {
  const params = new URLSearchParams();
  if (feedFiltro) params.set('q', feedFiltro);
  if (!reset && feedPosts.length) params.set('before', feedPosts[feedPosts.length - 1].id);
  const { posts, hasMore } = await api(`/feed${params.toString() ? `?${params}` : ''}`);
  feedPosts = reset ? posts : [...feedPosts, ...posts];
  feedHasMore = hasMore;
}

function feedView() {
  const acciones = puedePublicar()
    ? `<button class="btn btn-primary" data-nueva-publicacion>+ Nueva publicación</button>`
    : '';
  return page('Novedades', 'Lo que pasa en la empresa: avisos, novedades y horarios.', acciones)
    + `<div class="list-toolbar"><input class="filter" id="feed-filtro" placeholder="Buscar en las novedades…" value="${esc(feedFiltro)}" /></div>`
    + `<div id="feed-lista">${feedPosts.map(feedCard).join('') || '<div class="panel"><div class="empty">Todavía no hay publicaciones.' + (puedePublicar() ? ' Tocá «+ Nueva publicación» para escribir la primera.' : '') + '</div></div>'}</div>`
    + (feedHasMore ? `<div style="text-align:center;margin-top:16px"><button class="btn btn-ghost" id="feed-mas">Ver más</button></div>` : '');
}

function feedCard(p) {
  const destinatarios = p.audience === 'todos'
    ? 'Para todos'
    : `Para ${p.sectors.map((s) => esc(s.name)).join(', ') || 'nadie'}`;
  const puedeEditar = isAdmin() || (isStaff() && p.author?.id === currentUser.id);
  return `<article class="panel feed-card${p.pinned ? ' feed-pinned' : ''}" data-post="${p.id}">`
    + `<header class="feed-head">`
    + `<div class="feed-autor"><span class="feed-avatar">${esc((p.author?.name || '?').slice(0, 1))}</span>`
    + `<div><strong>${esc(p.author?.name || 'Sistema')}</strong>`
    + `<span class="feed-meta">${esc(destinatarios)} · ${esc(formatDateTime(p.createdAt))}</span></div></div>`
    + `<div class="feed-head-acciones">`
    + (p.pinned ? '<span class="feed-pin-tag">Fijada</span>' : '')
    + (puedeEditar
      ? `<button class="btn-icon" data-fijar="${p.id}" title="${p.pinned ? 'Dejar de fijar' : 'Fijar arriba'}">${p.pinned ? '★' : '☆'}</button>`
        + `<button class="btn-icon" data-editar-post="${p.id}" title="Editar">✎</button>`
        + `<button class="btn-icon" data-borrar-post="${p.id}" title="Eliminar">×</button>`
      : '')
    + `</div></header>`
    + `<h2 class="feed-titulo">${esc(p.title)}</h2>`
    + `<div class="feed-cuerpo">${renderBloques(p.blocks)}</div>`
    + `<footer class="feed-pie">`
    + `<button class="feed-accion${p.reacted ? ' activa' : ''}" data-reaccion="${p.id}">👍 Me gusta${p.reactionCount ? ` · ${p.reactionCount}` : ''}</button>`
    + `<button class="feed-accion" data-comentarios="${p.id}">💬 Comentar${p.commentCount ? ` · ${p.commentCount}` : ''}</button>`
    + `<span class="feed-vistas" data-vistas="${p.id}" title="Quiénes la vieron">👁 ${p.viewCount}</span>`
    + `</footer>`
    + `<div class="feed-comentarios" id="feed-com-${p.id}">${feedAbiertos.has(p.id) ? feedComentariosHtml(p.id) : ''}</div>`
    + `</article>`;
}

function feedComentariosHtml(postId) {
  const lista = feedComentarios.get(postId) || [];
  return `<div class="feed-com-lista">${lista.map((c) => `<div class="feed-com" data-comentario="${c.id}">`
    + `<span class="feed-avatar chico">${esc((c.author?.name || '?').slice(0, 1))}</span>`
    + `<div class="feed-com-cuerpo"><strong>${esc(c.author?.name || 'Alguien')}</strong>`
    + `<span class="feed-com-fecha">${esc(formatDateTime(c.createdAt))}</span>`
    + `<p>${esc(c.body)}</p></div>`
    + ((c.mine || isAdmin()) ? `<button class="btn-icon" data-borrar-comentario="${postId}:${c.id}" title="Borrar">×</button>` : '')
    + `</div>`).join('') || '<p class="muted feed-com-vacio">Todavía nadie comentó.</p>'}</div>`
    + `<form class="feed-com-form" data-com-form="${postId}">`
    + `<input class="blk-in" name="body" placeholder="Escribí un comentario…" maxlength="1500" autocomplete="off" />`
    + `<button class="btn btn-primary" type="submit">Enviar</button></form>`;
}

function wireFeed() {
  const filtro = document.getElementById('feed-filtro');
  if (filtro) {
    filtro.oninput = () => {
      clearTimeout(window.__feedDebounce);
      window.__feedDebounce = setTimeout(async () => {
        feedFiltro = filtro.value.trim();
        try { await loadFeed(true); render(); } catch (err) { toast(apiErrorMessage(err)); }
      }, 300);
    };
  }
  const mas = document.getElementById('feed-mas');
  if (mas) mas.onclick = async () => {
    try { await loadFeed(false); render(); } catch (err) { toast(apiErrorMessage(err)); }
  };

  document.querySelectorAll('[data-nueva-publicacion]').forEach((b) => b.onclick = () => openPostEditor(null));
  document.querySelectorAll('[data-editar-post]').forEach((b) => b.onclick = () => openPostEditor(b.dataset.editarPost));

  document.querySelectorAll('[data-borrar-post]').forEach((b) => b.onclick = async () => {
    if (!window.confirm('¿Eliminar esta publicación? Se van también sus comentarios.')) return;
    try {
      await api(`/feed/${b.dataset.borrarPost}`, { method: 'DELETE' });
      feedPosts = feedPosts.filter((p) => p.id !== b.dataset.borrarPost);
      toast('Publicación eliminada.');
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-fijar]').forEach((b) => b.onclick = async () => {
    const post = feedPosts.find((p) => p.id === b.dataset.fijar);
    if (!post) return;
    try {
      await api(`/feed/${post.id}`, { method: 'PATCH', body: { pinned: !post.pinned } });
      await loadFeed(true);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-reaccion]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.reaccion;
    try {
      const { reacted, count } = await api(`/feed/${id}/reaction`, { method: 'POST' });
      const post = feedPosts.find((p) => p.id === id);
      if (post) { post.reacted = reacted; post.reactionCount = count; }
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-comentarios]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.comentarios;
    if (feedAbiertos.has(id)) { feedAbiertos.delete(id); render(); return; }
    try {
      const { comments } = await api(`/feed/${id}/comments`);
      feedComentarios.set(id, comments);
      feedAbiertos.add(id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-com-form]').forEach((form) => form.onsubmit = async (e) => {
    e.preventDefault();
    const id = form.dataset.comForm;
    const input = form.querySelector('input[name=body]');
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    try {
      const { comment } = await api(`/feed/${id}/comments`, { method: 'POST', body: { body } });
      feedComentarios.set(id, [...(feedComentarios.get(id) || []), comment]);
      const post = feedPosts.find((p) => p.id === id);
      if (post) post.commentCount += 1;
      input.value = '';
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
    finally { input.disabled = false; }
  });

  document.querySelectorAll('[data-borrar-comentario]').forEach((b) => b.onclick = async () => {
    const [postId, commentId] = b.dataset.borrarComentario.split(':');
    try {
      await api(`/feed/${postId}/comments/${commentId}`, { method: 'DELETE' });
      feedComentarios.set(postId, (feedComentarios.get(postId) || []).filter((c) => c.id !== commentId));
      const post = feedPosts.find((p) => p.id === postId);
      if (post) post.commentCount = Math.max(0, post.commentCount - 1);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-vistas]').forEach((el) => el.onclick = async () => {
    try {
      const { viewers } = await api(`/feed/${el.dataset.vistas}/viewers`);
      modalInfo('Quiénes vieron esta publicación',
        viewers.length
          ? `<div class="visto-lista">${viewers.map((v) => `<div class="visto-item"><strong>${esc(v.name)}</strong><span class="muted">${esc(formatDateTime(v.viewedAt))}</span></div>`).join('')}</div>`
          : '<p class="muted">Todavía no la vio nadie.</p>');
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  wireBloques();
  marcarPublicacionesVistas();
}

// Marca como vistas las publicaciones que quedaron en pantalla. Se hace una
// sola vez por publicacion: el servidor no vuelve a contar la misma persona.
function marcarPublicacionesVistas() {
  const pendientes = feedPosts.filter((p) => !p.seen);
  if (!pendientes.length) return;
  pendientes.forEach((p) => { p.seen = true; });
  Promise.all(pendientes.map((p) => api(`/feed/${p.id}/view`, { method: 'POST' }).catch(() => {})))
    .then(() => refreshFeedBadge());
}

/* ---------- Alta y edicion de publicaciones ---------- */

function openPostEditor(postId) {
  const post = postId ? feedPosts.find((p) => p.id === postId) : null;
  const sectoresOrdenados = [...store.sectors].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const elegidos = new Set((post?.sectors || []).map((s) => s.id));

  const campos = textValue('title', 'Título', post?.title || '', 'form-span')
    + `<div class="field form-span"><label>¿Para quién es?</label>`
    + `<select name="audience" id="post-audiencia">`
    + `<option value="todos"${!post || post.audience === 'todos' ? ' selected' : ''}>Toda la empresa</option>`
    + `<option value="sectores"${post?.audience === 'sectores' ? ' selected' : ''}>Solo algunos sectores</option>`
    + `</select></div>`
    + `<div class="field form-span${post?.audience === 'sectores' ? '' : ' hidden'}" id="post-sectores">`
    + `<label>Sectores que la reciben</label><div class="member-list">`
    + sectoresOrdenados.map((s) => `<label class="member-item"><input type="checkbox" name="sectorIds" value="${esc(s.id)}"${elegidos.has(s.id) ? ' checked' : ''}/>`
      + `<span class="member-name">${esc(s.name)}</span></label>`).join('')
    + `</div></div>`
    + `<div class="field form-span"><label>Contenido</label><div id="post-bloques" class="blk-editor"></div></div>`;

  modal(post ? 'Editar publicación' : 'Nueva publicación', campos, async (f) => {
    const bloques = editor.valor();
    if (!bloques.length) throw new Error('Agregá al menos un bloque de contenido.');
    const audience = f.get('audience');
    const sectorIds = f.getAll('sectorIds');
    if (audience === 'sectores' && !sectorIds.length) throw new Error('Elegí al menos un sector, o publicá para todos.');
    const body = { title: f.get('title'), audience, sectorIds, blocks: bloques };
    if (post) await api(`/feed/${post.id}`, { method: 'PATCH', body });
    else await api('/feed', { method: 'POST', body: { ...body, pinned: false } });
    await loadFeed(true);
  });

  const editor = crearEditorBloques('post-bloques', post?.blocks || [{ kind: 'texto', data: { texto: '' } }]);
  const sel = document.getElementById('post-audiencia');
  const caja = document.getElementById('post-sectores');
  if (sel && caja) sel.onchange = () => caja.classList.toggle('hidden', sel.value !== 'sectores');
}

/* ---------- Badge de novedades sin ver ---------- */

async function refreshFeedBadge() {
  try {
    const { count } = await api('/feed/unseen-count');
    applyFeedBadge(count);
  } catch { /* si falla, el proximo evento lo corrige */ }
}

function applyFeedBadge(count) {
  feedUnseen = count;
  document.querySelectorAll('.nav-item[data-view="feed"]').forEach((el) => {
    const existente = el.querySelector('.nav-badge');
    if (count > 0) {
      const texto = count > 99 ? '99+' : String(count);
      if (existente) existente.textContent = texto;
      else el.insertAdjacentHTML('beforeend', `<span class="nav-badge">${texto}</span>`);
    } else if (existente) existente.remove();
  });
}

/* ---------- Bases de conocimiento ---------- */
// Cada area arma la suya. Adentro hay secciones y articulos; quien tiene
// permiso de lectura la consulta y quien tiene permiso de edicion la escribe.
// Los permisos los da un Administrador desde la propia base.

let kbSpaces = [];
let kbSpace = null;      // base abierta, con su arbol
let kbArticle = null;    // articulo abierto
let kbBusqueda = '';
let kbResultados = null;

async function loadKbSpaces() {
  const { spaces } = await api('/knowledge/spaces');
  kbSpaces = spaces;
}

async function abrirKbSpace(id) {
  const { space } = await api(`/knowledge/spaces/${id}`);
  kbSpace = space;
  kbArticle = null;
  // Se abre el primer articulo, para no dejar el panel derecho vacio.
  const primero = space.sections.flatMap((s) => s.articles)[0];
  if (primero) await abrirKbArticle(primero.id, false);
}

async function abrirKbArticle(id, redibujar = true) {
  const { article } = await api(`/knowledge/articles/${id}`);
  kbArticle = article;
  if (redibujar) render();
}

/* ---------- Listado de bases ---------- */

function kbView() {
  if (kbSpace) return kbSpaceView();
  const acciones = isAdmin() ? `<button class="btn btn-primary" data-nueva-base>+ Nueva base</button>` : '';
  const tarjetas = kbSpaces.map((s) => `<button type="button" class="kb-tarjeta" data-abrir-base="${s.id}">`
    + `<span class="kb-icono">${esc(s.icon || '📘')}</span>`
    + `<span class="kb-tarjeta-cuerpo"><strong>${esc(s.name)}</strong>`
    + `<span class="muted">${esc(s.description || 'Sin descripción')}</span>`
    + `<span class="kb-tarjeta-meta">${s.sectionCount} ${s.sectionCount === 1 ? 'sección' : 'secciones'}`
    + `${s.myLevel === 'edicion' ? ' · podés editarla' : ''}</span></span></button>`).join('');
  return page('Bases de conocimiento', 'Los instructivos, accesos y procedimientos de cada área.', acciones)
    + `<div class="list-toolbar"><input class="filter" id="kb-buscar" placeholder="Buscar en todas las bases que podés ver…" value="${esc(kbBusqueda)}" /></div>`
    + (kbResultados
      ? `<div class="panel"><div class="panel-head"><h2>Resultados (${kbResultados.length})</h2><a data-kb-limpiar>Volver a las bases</a></div>`
        + (kbResultados.length
          ? kbResultados.map((r) => `<div class="event linkable" data-resultado="${r.spaceId}:${r.id}"><strong>${esc(r.title)}</strong>`
            + `<span>${esc(r.spaceName)} · ${esc(r.sectionName)}</span></div>`).join('')
          : '<div class="empty">No se encontró nada con ese texto.</div>')
        + `</div>`
      : `<div class="kb-grilla">${tarjetas || '<div class="panel"><div class="empty">Todavía no hay bases de conocimiento'
        + (isAdmin() ? '. Tocá «+ Nueva base» para crear la primera.' : ' a las que tengas acceso.') + '</div></div>'}</div>`);
}

/* ---------- Una base abierta: arbol + articulo ---------- */

function kbSpaceView() {
  const puedeEditar = kbSpace.myLevel === 'edicion';
  const arbol = kbSpace.sections.map((s) => `<div class="kb-seccion">`
    + `<div class="kb-seccion-head"><span>${esc(s.name)}</span>`
    + (puedeEditar
      ? `<span class="kb-seccion-acciones">`
        + `<button class="btn-icon" data-nuevo-articulo="${s.id}" title="Nuevo artículo">+</button>`
        + `<button class="btn-icon" data-borrar-seccion="${s.id}" title="Eliminar sección">×</button></span>`
      : '')
    + `</div>`
    + `<div class="kb-articulos">${s.articles.map((a) => `<button type="button" class="kb-articulo${kbArticle?.id === a.id ? ' activo' : ''}" data-abrir-articulo="${a.id}">${esc(a.title)}</button>`).join('')
      || '<p class="muted kb-sin-articulos">Sin artículos</p>'}</div></div>`).join('');

  const acciones = `<button class="btn btn-ghost" data-volver-bases>← Todas las bases</button>`
    + (puedeEditar ? `<button class="btn btn-ghost" data-nueva-seccion>+ Sección</button>` : '')
    + (isAdmin() ? `<button class="btn btn-ghost" data-permisos-base>Permisos</button>` : '');

  return page(`${kbSpace.icon || '📘'} ${esc(kbSpace.name)}`, esc(kbSpace.description || 'Base de conocimiento'), acciones)
    + `<div class="kb-layout">`
    + `<aside class="panel kb-arbol">${arbol || '<div class="empty">Todavía no hay secciones.' + (puedeEditar ? ' Creá la primera con «+ Sección».' : '') + '</div>'}</aside>`
    + `<section class="panel kb-contenido">${kbArticleView(puedeEditar)}</section>`
    + `</div>`;
}

function kbArticleView(puedeEditar) {
  if (!kbArticle) {
    return `<div class="empty">Elegí un artículo de la izquierda`
      + (puedeEditar ? ', o creá uno nuevo con el «+» de una sección.' : '.') + `</div>`;
  }
  return `<div class="kb-articulo-head"><div><h2>${esc(kbArticle.title)}</h2>`
    + `<p class="muted">${esc(kbArticle.sectionName)}`
    + (kbArticle.updatedBy ? ` · actualizado por ${esc(kbArticle.updatedBy.name)} el ${esc(formatDateTime(kbArticle.updatedAt))}` : '')
    + `</p></div>`
    + (puedeEditar
      ? `<div class="kb-articulo-acciones">`
        + `<button class="btn btn-ghost" data-editar-articulo="${kbArticle.id}">Editar</button>`
        + `<button class="btn btn-ghost" data-borrar-articulo="${kbArticle.id}">Eliminar</button></div>`
      : '')
    + `</div><div class="kb-articulo-cuerpo">${renderBloques(kbArticle.blocks)}</div>`;
}

function wireKb() {
  const buscar = document.getElementById('kb-buscar');
  if (buscar) buscar.oninput = () => {
    clearTimeout(window.__kbDebounce);
    window.__kbDebounce = setTimeout(async () => {
      kbBusqueda = buscar.value.trim();
      if (kbBusqueda.length < 2) { kbResultados = null; render(); return; }
      try {
        const { results } = await api(`/knowledge/search?q=${encodeURIComponent(kbBusqueda)}`);
        kbResultados = results;
        render();
      } catch (err) { toast(apiErrorMessage(err)); }
    }, 350);
  };

  document.querySelectorAll('[data-kb-limpiar]').forEach((el) => el.onclick = () => {
    kbBusqueda = ''; kbResultados = null; render();
  });
  document.querySelectorAll('[data-resultado]').forEach((el) => el.onclick = async () => {
    const [spaceId, articleId] = el.dataset.resultado.split(':');
    try {
      kbResultados = null; kbBusqueda = '';
      await abrirKbSpace(spaceId);
      await abrirKbArticle(articleId, false);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-abrir-base]').forEach((el) => el.onclick = async () => {
    try { await abrirKbSpace(el.dataset.abrirBase); render(); } catch (err) { toast(apiErrorMessage(err)); }
  });
  document.querySelectorAll('[data-volver-bases]').forEach((el) => el.onclick = async () => {
    kbSpace = null; kbArticle = null;
    try { await loadKbSpaces(); render(); } catch (err) { toast(apiErrorMessage(err)); }
  });
  document.querySelectorAll('[data-abrir-articulo]').forEach((el) => el.onclick = async () => {
    try { await abrirKbArticle(el.dataset.abrirArticulo); } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-nueva-base]').forEach((el) => el.onclick = () => {
    modal('Nueva base de conocimiento',
      field('name', 'Nombre del área o tema', 'text', 'form-span')
      + `<div class="field"><label>Ícono</label><input name="icon" value="📘" maxlength="4" /></div>`
      + `<div class="field"><label>Descripción</label><input name="description" placeholder="Para qué sirve" /></div>`,
      async (f) => {
        const { space } = await api('/knowledge/spaces', {
          method: 'POST',
          body: { name: f.get('name'), icon: f.get('icon') || '📘', description: f.get('description') || '' },
        });
        await loadKbSpaces();
        await abrirKbSpace(space.id);
      });
    relaxOptionalFields();
  });

  document.querySelectorAll('[data-nueva-seccion]').forEach((el) => el.onclick = () => {
    modal('Nueva sección', field('name', 'Nombre de la sección', 'text', 'form-span'), async (f) => {
      await api(`/knowledge/spaces/${kbSpace.id}/sections`, { method: 'POST', body: { name: f.get('name') } });
      await abrirKbSpace(kbSpace.id);
    });
  });

  document.querySelectorAll('[data-borrar-seccion]').forEach((el) => el.onclick = async () => {
    if (!window.confirm('¿Eliminar esta sección?')) return;
    try {
      await api(`/knowledge/sections/${el.dataset.borrarSeccion}`, { method: 'DELETE' });
      toast('Sección eliminada.');
      await abrirKbSpace(kbSpace.id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-nuevo-articulo]').forEach((el) => el.onclick = () => openArticleEditor(null, el.dataset.nuevoArticulo));
  document.querySelectorAll('[data-editar-articulo]').forEach((el) => el.onclick = () => openArticleEditor(kbArticle, kbArticle.sectionId));

  document.querySelectorAll('[data-borrar-articulo]').forEach((el) => el.onclick = async () => {
    if (!window.confirm(`¿Eliminar el artículo "${kbArticle.title}"?`)) return;
    try {
      await api(`/knowledge/articles/${el.dataset.borrarArticulo}`, { method: 'DELETE' });
      toast('Artículo eliminado.');
      const id = kbSpace.id;
      kbArticle = null;
      await abrirKbSpace(id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-permisos-base]').forEach((el) => el.onclick = () => openKbPermisos());

  wireBloques();
}

function openArticleEditor(article, sectionId) {
  const secciones = kbSpace.sections;
  const campos = textValue('title', 'Título del artículo', article?.title || '', 'form-span')
    + `<div class="field form-span"><label>Sección</label><select name="sectionId">`
    + secciones.map((s) => `<option value="${esc(s.id)}"${(article?.sectionId || sectionId) === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')
    + `</select></div>`
    + `<div class="field form-span"><label>Contenido</label><div id="kb-bloques" class="blk-editor"></div></div>`;

  modal(article ? 'Editar artículo' : 'Nuevo artículo', campos, async (f) => {
    const bloques = editor.valor();
    const body = { title: f.get('title'), sectionId: f.get('sectionId'), blocks: bloques };
    if (article) await api(`/knowledge/articles/${article.id}`, { method: 'PATCH', body });
    else {
      const { article: creado } = await api('/knowledge/articles', { method: 'POST', body });
      kbArticle = creado;
    }
    const id = kbSpace.id;
    await abrirKbSpace(id);
    if (article) await abrirKbArticle(article.id, false);
  });

  const editor = crearEditorBloques('kb-bloques', article?.blocks || []);
}

async function openKbPermisos() {
  let permisos;
  try { ({ permissions: permisos } = await api(`/knowledge/spaces/${kbSpace.id}/permissions`)); }
  catch (err) { toast(apiErrorMessage(err)); return; }

  const sectoresOrdenados = [...store.sectors].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const usuariosOrdenados = [...store.users].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const filas = permisos.map((p) => {
    const quien = p.sector ? `Sector · ${esc(p.sector.name)}` : p.role ? `Rango · ${esc(p.role)}` : `Persona · ${esc(p.user?.name || '?')}`;
    return `<div class="cat-item"><span>${quien} — <strong>${esc(p.level)}</strong></span>`
      + `<button type="button" class="cat-remove" data-quitar-permiso="${p.id}" title="Quitar">×</button></div>`;
  }).join('');

  const contenido = `<div class="field form-span"><label>Quiénes tienen acceso</label>`
    + `<div class="cat-list" id="kb-permisos-lista">${filas || '<p class="muted">Todavía nadie, además del Administrador y de quien la creó.</p>'}</div></div>`
    + `<div class="field"><label>Dar acceso a</label><select name="tipo" id="kb-perm-tipo">`
    + `<option value="sectorId">Un sector</option><option value="role">Un rango</option><option value="userId">Una persona</option></select></div>`
    + `<div class="field"><label>Nivel</label><select name="level"><option value="lectura">Solo lectura</option><option value="edicion">Lectura y edición</option></select></div>`
    + `<div class="field form-span" id="kb-perm-destino"></div>`;

  modal(`Permisos de «${kbSpace.name}»`, contenido, async (f) => {
    const tipo = f.get('tipo');
    const destino = f.get('destino');
    if (!destino) throw new Error('Elegí a quién le vas a dar acceso.');
    await api(`/knowledge/spaces/${kbSpace.id}/permissions`, {
      method: 'POST',
      body: { level: f.get('level'), [tipo]: destino },
    });
    await abrirKbSpace(kbSpace.id);
  });

  const tipoSel = document.getElementById('kb-perm-tipo');
  const destinoCaja = document.getElementById('kb-perm-destino');
  const pintarDestino = () => {
    const opciones = tipoSel.value === 'sectorId'
      ? sectoresOrdenados.map((s) => [s.id, s.name])
      : tipoSel.value === 'role'
        ? [['Administrador', 'Administrador'], ['Supervisor', 'Supervisor'], ['User', 'User']]
        : usuariosOrdenados.map((u) => [u.id, u.name]);
    destinoCaja.innerHTML = `<label>${tipoSel.value === 'sectorId' ? 'Sector' : tipoSel.value === 'role' ? 'Rango' : 'Persona'}</label>`
      + `<select name="destino">${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
  };
  tipoSel.onchange = pintarDestino;
  pintarDestino();

  document.querySelectorAll('[data-quitar-permiso]').forEach((b) => b.onclick = async () => {
    try {
      await api(`/knowledge/spaces/${kbSpace.id}/permissions/${b.dataset.quitarPermiso}`, { method: 'DELETE' });
      b.closest('.cat-item').remove();
      toast('Permiso quitado.');
    } catch (err) { toast(apiErrorMessage(err)); }
  });
}
