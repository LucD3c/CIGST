import { render } from './app.js';
import { loginView } from './armazon.js';
import { appendChatMessage, applyChatUnreadCount, chatBubble, markThreadRead, openChatThread, openGroupThread, scrollChatToBottom } from './chat.js';
import { E } from './estado.js';
import { feedComentarios, refreshFeedBadge } from './feed.js';
import { toast } from './formularios.js';
import { normalizeTicket } from './normalizar.js';
import { applyNotifCount, refreshNotifBadge } from './notificaciones.js';
import { $, api } from './nucleo.js';
import { refreshList } from './paginacion.js';
import { employee } from './util.js';

/* ---------- Tiempo real (WebSocket) ---------- */
// Espera antes de reintentar cuando se corta la conexion. Arranca corta y va
// subiendo (backoff) para no castigar al servidor si lo que se cayo es el
// servidor y no la red.
export const RT_RECONNECT_MIN_MS = 1000;
export const RT_RECONNECT_MAX_MS = 20000;
export let rtSocket = null;
export let rtReconnectDelay = RT_RECONNECT_MIN_MS;
export let rtReconnectHandle = null;
// Cuando el servidor cierra la conexion a proposito (cerraste sesion, te
// desactivaron) NO hay que reintentar: reconectar seria pelearle al servidor.
export let rtDeliberatelyClosed = false;
// Mensajes propios mandados por socket que todavia esperan confirmacion.
export const rtPendingRefs = new Set();

export function rtUrl(){
  const scheme=location.protocol==='https:'?'wss:':'ws:';
  return `${scheme}//${location.host}/ws`;
}
export function connectRealtime(){
  if(!E.session)return;
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
export function scheduleRealtimeReconnect(){
  if(rtReconnectHandle||rtDeliberatelyClosed||!E.session)return;
  rtReconnectHandle=setTimeout(()=>{
    rtReconnectHandle=null;
    connectRealtime();
    rtReconnectDelay=Math.min(rtReconnectDelay*2,RT_RECONNECT_MAX_MS);
  },rtReconnectDelay);
}
export function disconnectRealtime(){
  rtDeliberatelyClosed=true;
  if(rtReconnectHandle){clearTimeout(rtReconnectHandle);rtReconnectHandle=null;}
  if(rtSocket){try{rtSocket.close(1000,'salir');}catch{ /* ya estaba cerrado */ }rtSocket=null;}
  rtPendingRefs.clear();
}
export function rtSend(payload){
  if(!rtSocket||rtSocket.readyState!==WebSocket.OPEN)return false;
  try{rtSocket.send(JSON.stringify(payload));return true;}catch{return false;}
}
export const rtConnected=()=>Boolean(rtSocket&&rtSocket.readyState===WebSocket.OPEN);

// Sonda de vida. Al suspender el equipo (cerrar la tapa) o perder el wifi, el
// navegador puede dejar el socket en estado "abierto" aunque ya no pase nada
// por el: readyState sigue en OPEN y los mensajes se pierden en silencio. El
// servidor lo detecta con su propio ping cada 30s, pero para que la vuelta sea
// inmediata se comprueba tambien desde aca en los dos momentos en que eso
// pasa: cuando la pestana vuelve a estar visible y cuando vuelve la red.
// No es polling: no se pide informacion, solo se pregunta "¿seguís ahí?" y
// unicamente en esos dos eventos.
export const RT_PROBE_TIMEOUT_MS = 4000;
export let rtProbeHandle = null;
export const rtPongListeners = new Set();
export function probeRealtime(){
  if(!E.session||rtDeliberatelyClosed)return;
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
export async function resyncAfterReconnect(){
  if(!E.session)return;
  try{const{count}=await api('/chat/unread-count');applyChatUnreadCount(count);}
  catch{ /* si falla, el proximo evento lo corrige */ }
  refreshNotifBadge();
  if(E.currentView!=='chat')return;
  if(E.activeChatConversationId)openChatThread(E.activeChatConversationId);
  else if(E.activeChatGroupId)openGroupThread(E.activeChatGroupId);
}

export function handleRealtimeEvent(event,data){
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
    case 'E.session:closed':
      rtDeliberatelyClosed=true;
      E.session=false;E.currentUser=null;
      disconnectRealtime();
      loginView();
      return toast(data?.reason||'Tu sesión se cerró.');
    case 'error':return toast(data?.message||'Error de conexión.');
    default:return;
  }
}

// Mensaje empujado por el servidor. Si es del hilo abierto se agrega a la
// vista; si no, solo se actualiza el resumen de la lista.
export function onRealtimeChatMessage(m){
  if(!m)return;
  const delHiloAbierto=(m.conversationId&&m.conversationId===E.activeChatConversationId)
    ||(m.groupId&&m.groupId===E.activeChatGroupId);
  if(delHiloAbierto){
    if(E.chatMessages.some(x=>x.id===m.id))return; // ya estaba (eco propio)
    appendChatMessage(m);
    // Con el hilo a la vista, lo que llega se da por leido.
    if(!m.mine)markThreadRead(m.conversationId?{conversationId:m.conversationId}:{groupId:m.groupId});
    return;
  }
  const lista=m.groupId?E.chatGroups:E.chatConversations;
  const item=lista.find(x=>x.id===(m.groupId||m.conversationId));
  if(item){
    item.lastMessage={body:m.body,senderId:m.senderId,createdAt:m.createdAt,mine:Boolean(m.mine)};
    item.lastMessageAt=m.createdAt;
    if(!m.mine)item.unreadCount=(item.unreadCount||0)+1;
  }
  if(E.currentView==='chat')render();
}

export function onRealtimeChatRead(data){
  if(!data?.conversationId||data.conversationId!==E.activeChatConversationId)return;
  const ahora=new Date().toISOString();
  E.chatMessages=E.chatMessages.map(m=>(m.mine&&!m.readAt?{...m,readAt:ahora}:m));
  const pane=document.getElementById('chat-messages');
  if(pane){pane.innerHTML=E.chatMessages.map(chatBubble).join('');scrollChatToBottom();}
}

// Publicacion nueva o editada. El servidor solo la manda a quien puede verla.
export function onRealtimeFeedPost(post){
  if(!post?.id)return;
  const idx=E.feedPosts.findIndex(p=>p.id===post.id);
  if(idx>=0)E.feedPosts[idx]={...E.feedPosts[idx],...post};
  else{E.feedPosts.unshift(post);refreshFeedBadge();}
  if(E.currentView==='feed')render();
}
export function onRealtimeFeedRemoved(data){
  if(!data?.postId)return;
  const antes=E.feedPosts.length;
  E.feedPosts=E.feedPosts.filter(p=>p.id!==data.postId);
  if(E.currentView==='feed'&&E.feedPosts.length!==antes)render();
}
export function onRealtimeFeedComment(c){
  if(!c?.postId)return;
  const post=E.feedPosts.find(p=>p.id===c.postId);
  if(post)post.commentCount=(post.commentCount||0)+1;
  if(feedComentarios.has(c.postId)){
    const lista=feedComentarios.get(c.postId);
    if(!lista.some(x=>x.id===c.id))feedComentarios.set(c.postId,[...lista,{...c,mine:c.author?.id===E.currentUser.id}]);
  }
  if(E.currentView==='feed')render();
}
export function onRealtimeFeedCommentRemoved(data){
  if(!data?.postId)return;
  const post=E.feedPosts.find(p=>p.id===data.postId);
  if(post)post.commentCount=Math.max(0,(post.commentCount||0)-1);
  if(feedComentarios.has(data.postId)){
    feedComentarios.set(data.postId,feedComentarios.get(data.postId).filter(c=>c.id!==data.commentId));
  }
  if(E.currentView==='feed')render();
}
export function onRealtimeFeedReaction(data){
  const post=E.feedPosts.find(p=>p.id===data?.postId);
  if(!post)return;
  post.reactionCount=data.count;
  if(E.currentView==='feed')render();
}

// Ticket creado o modificado por otra persona. El servidor solo manda esto a
// quien tiene permiso de verlo: aca no hace falta volver a filtrar.
export function onRealtimeTicket(ticket){
  if(!ticket?.id)return;
  const normalizado=normalizeTicket(ticket);
  const idx=E.store.tickets.findIndex(t=>t.id===ticket.id);
  if(idx>=0)E.store.tickets[idx]={...E.store.tickets[idx],...normalizado};
  else E.store.tickets.unshift(normalizado);
  if(['tickets','dashboard','employee-portal'].includes(E.currentView)){
    if(document.getElementById('tickets-table'))void refreshList('tickets');
    else render();
  }
}
