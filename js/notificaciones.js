import { render } from './app.js';
import { applyChatUnreadCount } from './chat.js';
import { E } from './estado.js';
import { refreshFeedBadge } from './feed.js';
import { toast } from './formularios.js';
import { ticketDetail } from './listas.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { connectRealtime } from './tiemporeal.js';
import { badge, employee, esc, isStaff, traerTicket } from './util.js';

/* ---------- Notificaciones (campanita) ---------- */
// Pinta el numero de la campanita. Lo empuja el servidor con cada
// notificacion nueva; el pedido HTTP queda solo para el arranque y para
// resincronizar despues de una desconexion.
export function applyNotifCount(count){
  {
    E.notifUnreadCount=count;
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
export async function refreshNotifBadge(){
  try{const{count}=await api('/notifications/unread-count');applyNotifCount(count);}
  catch{ /* si falla, la proxima notificacion trae el numero al dia */ }
}
export async function toggleNotifPanel(){
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
export async function openNotification(id,targetType,targetId){
  try{await api(`/notifications/${id}/read`,{method:'POST'});}catch{ /* no bloquea la navegacion */ }
  const panel=document.getElementById('notif-panel');
  if(panel)panel.classList.add('hidden');
  refreshNotifBadge();
  if(targetType==='ticket'&&targetId){
    E.currentView=isStaff()?'tickets':'employee-portal';
    E.currentDetailId=null;
    await render();
    const ticket=await traerTicket(targetId);
    if(ticket)ticketDetail(ticket);
    else toast('Ese ticket ya no está disponible.');
    return;
  }
  if(targetType==='post'){
    E.currentView='feed';
    E.currentDetailId=null;
    await render();
    return;
  }
  if(targetType==='group'||targetType==='chat'){
    E.currentView='chat';
    if(targetType==='group'&&targetId)E.activeChatGroupId=targetId;
    render();
    return;
  }
  render();
}

/* ---------- Arranque del tiempo real ---------- */
// Una sola conexion abierta mientras dura la sesion. Los contadores se piden
// una vez al entrar; despues los actualiza el servidor cuando cambian.
export function startRealtime(){
  connectRealtime();
  api('/chat/unread-count').then(({count})=>applyChatUnreadCount(count)).catch(()=>{});
  refreshNotifBadge();
  refreshFeedBadge();
}
