import { ATTACH_ACCEPT, ATTACH_MAX_FILES, attachmentsHtml, formatBytes, imagenesDelPegado, uploadFiles } from './adjuntos.js';
import { render } from './app.js';
import { nav, page } from './armazon.js';
import { E } from './estado.js';
import { closeModal, field, modal, textValue, toast } from './formularios.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { RT_PROBE_TIMEOUT_MS, probeRealtime, rtPendingRefs, rtSend } from './tiemporeal.js';
import { badge, esc, isAdmin } from './util.js';

/* ---------- Chat interno (1 a 1 y grupos) ---------- */
export function chatConvRowHtml(c){
  const previewText=c.lastMessage?(c.lastMessage.mine?'Vos: ':'')+c.lastMessage.body:'Sin mensajes todavía.';
  const badge=c.unreadCount>0?`<span class="chat-conv-badge">${c.unreadCount>99?'99+':c.unreadCount}</span>`:'';
  return `<div class="chat-conv ${c.id===E.activeChatConversationId?'active':''}" data-conversation="${c.id}"><div class="chat-conv-row"><strong>${esc(c.otherUser.name)}</strong>${badge}</div><div class="chat-conv-preview">${esc(previewText)}</div></div>`;
}
// Los grupos van SIEMPRE primeros en la lista (fijados), con su etiqueta.
export function chatGroupRowHtml(g){
  const previewText=g.lastMessage?`${g.lastMessage.mine?'Vos':g.lastMessage.senderName}: ${g.lastMessage.body}`:'Sin mensajes todavía.';
  const badge=g.unreadCount>0?`<span class="chat-conv-badge">${g.unreadCount>99?'99+':g.unreadCount}</span>`:'';
  return `<div class="chat-conv ${g.id===E.activeChatGroupId?'active':''}" data-group="${g.id}"><div class="chat-conv-row"><strong><span class="chat-group-tag">Grupo</span> ${esc(g.name)}</strong>${badge}</div><div class="chat-conv-preview">${esc(previewText)}</div></div>`;
}
export function chatListHtml(){
  const rows=[...E.chatGroups.map(chatGroupRowHtml),...E.chatConversations.map(chatConvRowHtml)];
  return rows.length?rows.join(''):'<div class="empty">Todavía no tenés conversaciones.</div>';
}
export async function chatView(){
  const {conversations,groups}=await api('/chat/conversations');
  E.chatConversations=conversations;
  E.chatGroups=groups;
  const buttons=`${isAdmin()?'<button class="btn btn-ghost" type="button" data-chat-new-group>+ Nuevo grupo</button> ':''}<button class="btn btn-primary" type="button" data-chat-new>+ Nueva conversación</button>`;
  return page('Mensajes','Chat interno entre usuarios de la plataforma, sin salir de CIGST.',`<span>${buttons}</span>`)
    +`<div class="chat-layout"><div class="panel chat-list">${chatListHtml()}</div><div class="panel chat-thread" id="chat-thread"><div class="empty">Elegí una conversación para ver los mensajes.</div></div></div>`;
}
export function wireChatList(){
  document.querySelectorAll('[data-conversation]').forEach(el=>el.onclick=()=>openChatThread(el.dataset.conversation));
  document.querySelectorAll('[data-group]').forEach(el=>el.onclick=()=>openGroupThread(el.dataset.group));
}
export function wireChatView(){
  wireChatList();
  const newBtn=document.querySelector('[data-chat-new]');
  if(newBtn)newBtn.onclick=openNewChatPicker;
  const newGroupBtn=document.querySelector('[data-chat-new-group]');
  if(newGroupBtn)newGroupBtn.onclick=openNewGroupModal;
  if(E.activeChatGroupId&&E.chatGroups.some(g=>g.id===E.activeChatGroupId)){
    openGroupThread(E.activeChatGroupId);
  }else if(E.activeChatConversationId&&E.chatConversations.some(c=>c.id===E.activeChatConversationId)){
    openChatThread(E.activeChatConversationId);
  }
}
export async function openNewChatPicker(){
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
    const existing=E.chatConversations.find(c=>c.otherUser.id===recipientId);
    if(existing){openChatThread(existing.id);return;}
    openNewThreadComposer(recipientId,recipient?.name||'Usuario');
  });
}
export function chatBubble(m){
  const sender=m.senderName&&!m.mine?`<div class="chat-bubble-sender">${esc(m.senderName)}</div>`:'';
  const text=m.body?`<div class="chat-bubble-text">${esc(m.body)}</div>`:'';
  const files=attachmentsHtml(m.attachments,true);
  return `<div class="chat-bubble ${m.mine?'mine':''}">${sender}${text}${files}<div class="chat-bubble-time">${formatDateTime(m.createdAt)}</div></div>`;
}
export function renderChatMessagesInner(hasMore){
  return (hasMore?'<button type="button" class="btn btn-ghost chat-load-more" id="chat-load-more">Cargar mensajes anteriores</button>':'')+E.chatMessages.map(chatBubble).join('');
}
export function renderChatThreadShell(otherName,hasMore,headExtra=''){
  return `<div class="chat-thread-head"><div class="row-between"><strong>${esc(otherName)}</strong>${headExtra}</div></div>`
    +`<div class="chat-messages" id="chat-messages">${renderChatMessagesInner(hasMore)}</div>`
    +`<div class="attach-list" id="chat-attach-list"></div>`
    +`<form class="chat-composer" id="chat-composer">`
      +`<label class="attach-btn" title="Adjuntar archivo">📎<input type="file" id="chat-attach-input" multiple accept="${ATTACH_ACCEPT}" hidden /></label>`
      +`<textarea name="body" maxlength="2000" placeholder="Escribí un mensaje, adjuntá un archivo o pegá una captura con Ctrl+V… (Enter para enviar)"></textarea>`
      +`<button class="btn btn-primary" type="submit">Enviar</button>`
    +`</form>`;
}
export function scrollChatToBottom(){
  const container=document.getElementById('chat-messages');
  if(container)container.scrollTop=container.scrollHeight;
}
export function appendChatMessage(m){
  E.chatMessages.push(m);
  const container=document.getElementById('chat-messages');
  if(container){container.insertAdjacentHTML('beforeend',chatBubble(m));scrollChatToBottom();}
}
export function markActiveChatRow(){
  document.querySelectorAll('[data-conversation]').forEach(el=>el.classList.toggle('active',el.dataset.conversation===E.activeChatConversationId));
  document.querySelectorAll('[data-group]').forEach(el=>el.classList.toggle('active',el.dataset.group===E.activeChatGroupId));
}
export async function openChatThread(conversationId){
  E.activeChatConversationId=conversationId;
  E.activeChatGroupId=null;
  markActiveChatRow();
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML='<div class="empty">Cargando…</div>';
  const conv=E.chatConversations.find(c=>c.id===conversationId);
  let messages,hasMore;
  try{({messages,hasMore}=await api(`/chat/conversations/${conversationId}/messages`));}
  catch(err){toast(apiErrorMessage(err));pane.innerHTML='<div class="empty">No se pudo cargar la conversación.</div>';return;}
  E.chatMessages=messages;
  pane.innerHTML=renderChatThreadShell(conv?.otherUser?.name||'Conversación',hasMore);
  scrollChatToBottom();
  wireChatComposer({conversationId});
  wireChatLoadMore({conversationId},hasMore);
  markThreadRead({conversationId});
  if(conv)conv.unreadCount=0;
}
export async function openGroupThread(groupId){
  E.activeChatGroupId=groupId;
  E.activeChatConversationId=null;
  markActiveChatRow();
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML='<div class="empty">Cargando…</div>';
  const group=E.chatGroups.find(g=>g.id===groupId);
  let messages,hasMore;
  try{({messages,hasMore}=await api(`/chat/groups/${groupId}/messages`));}
  catch(err){toast(apiErrorMessage(err));pane.innerHTML='<div class="empty">No se pudo cargar el grupo.</div>';return;}
  E.chatMessages=messages;
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
export function openNewThreadComposer(recipientId,recipientName){
  E.activeChatConversationId=null;
  E.activeChatGroupId=null;
  E.chatMessages=[];
  markActiveChatRow();
  const pane=document.getElementById('chat-thread');
  if(!pane)return;
  pane.innerHTML=renderChatThreadShell(recipientName,false);
  wireChatComposer({pendingRecipientId:recipientId});
}
export function chatMessagesEndpoint(target){
  return target.groupId?`/chat/groups/${target.groupId}/messages`:`/chat/conversations/${target.conversationId}/messages`;
}
export function wireChatLoadMore(target,hasMore){
  const btn=document.getElementById('chat-load-more');
  if(!btn)return;
  if(!hasMore){btn.remove();return;}
  btn.onclick=async()=>{
    const oldestId=E.chatMessages[0]?.id;
    if(!oldestId)return;
    btn.disabled=true;
    try{
      const {messages,hasMore:more}=await api(`${chatMessagesEndpoint(target)}?before=${oldestId}`);
      const container=document.getElementById('chat-messages');
      const prevScrollHeight=container.scrollHeight;
      E.chatMessages=[...messages,...E.chatMessages];
      container.innerHTML=renderChatMessagesInner(more);
      wireChatLoadMore(target,more);
      container.scrollTop=container.scrollHeight-prevScrollHeight;
    }catch(err){toast(apiErrorMessage(err));btn.disabled=false;}
  };
}
export function wireChatComposer(target){
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
              if(!E.chatMessages.some(x=>x.id===message.id))appendChatMessage(message);
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
        E.activeChatConversationId=conversation.id;
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
  // Ctrl+V con una imagen en el portapapeles: se adjunta sola. Es el flujo de
  // la herramienta de Recortes de Windows, que deja la captura copiada y no
  // guardada en ningun archivo. Si lo pegado es texto, sigue de largo.
  textarea.addEventListener('paste',async e=>{
    const imagenes=imagenesDelPegado(e);
    if(!imagenes.length)return;
    e.preventDefault();
    if(pending.length>=ATTACH_MAX_FILES){
      toast(`Se pueden adjuntar hasta ${ATTACH_MAX_FILES} archivos por mensaje.`);
      return;
    }
    const antes=textarea.placeholder;
    textarea.placeholder='Adjuntando la imagen…';
    try{
      const subidas=await uploadFiles(imagenes.slice(0,ATTACH_MAX_FILES-pending.length));
      subidas.forEach(a=>{ if(pending.length<ATTACH_MAX_FILES)pending.push(a); });
      paintPending();
    }catch(err){toast(err.message||'No se pudo adjuntar la imagen.');}
    finally{textarea.placeholder=antes;}
  });
}
export async function refreshChatConversationList(){
  try{
    const {conversations,groups}=await api('/chat/conversations');
    E.chatConversations=conversations;
    E.chatGroups=groups;
    const listEl=document.querySelector('.chat-list');
    if(listEl){
      listEl.innerHTML=chatListHtml();
      wireChatList();
    }
  }catch{ /* silencioso: no interrumpe la conversacion abierta */ }
}
// Marca el hilo como leido. Va por el socket si esta abierto (sin pedido HTTP)
// y cae al endpoint de siempre si justo esta reconectando.
export function markThreadRead(target){
  if(rtSend({type:'chat:read',...target}))return;
  const endpoint=target.groupId?`/chat/groups/${target.groupId}/read`:`/chat/conversations/${target.conversationId}/read`;
  api(endpoint,{method:'POST'}).catch(()=>{ /* se reintenta al reabrir el hilo */ });
}

/* ---------- Grupos: alta y edicion (solo Admin) ---------- */
export function groupMemberCheckboxes(users,selectedIds){
  const sel=new Set(selectedIds||[]);
  // Ordenados por nombre y con el sector de cada uno: al armar un grupo hay
  // que poder ver de que area es cada persona sin tener que salir a buscarlo.
  const rows=[...users].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}))
    .map(u=>`<label class="member-item"><input type="checkbox" name="memberIds" value="${esc(u.id)}"${sel.has(u.id)?' checked':''}/><span class="member-name">${esc(u.name)}</span>${u.sectorName?`<span class="member-sector">${esc(u.sectorName)}</span>`:''}<span class="member-role">${esc(u.role)}</span></label>`).join('');
  return `<div class="field form-span"><label>Integrantes (${users.length})</label><div class="member-list">${rows||'<p class="muted" style="padding:12px">No hay otros usuarios activos.</p>'}</div></div>`;
}
export async function openNewGroupModal(){
  let users;
  try{({users}=await api('/chat/directory'));}catch(err){toast(apiErrorMessage(err));return;}
  modal('Nuevo grupo',field('name','Nombre del grupo','text','form-span')+groupMemberCheckboxes(users,[]),async f=>{
    const memberIds=f.getAll('memberIds');
    await api('/chat/groups',{method:'POST',body:{name:f.get('name'),memberIds}});
    E.activeChatGroupId=null;
  });
}
export async function openGroupEdit(groupId){
  const group=E.chatGroups.find(g=>g.id===groupId);
  if(!group)return;
  let users;
  try{({users}=await api('/chat/directory'));}catch(err){toast(apiErrorMessage(err));return;}
  // El directorio excluye al propio usuario: el admin se agrega a mano para
  // poder verse (y sacarse) de la lista de integrantes.
  const all=[{id:E.currentUser.id,name:`${E.currentUser.name} (vos)`,role:E.currentUser.role},...users];
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
      E.activeChatGroupId=null;
      toast('Grupo eliminado.');
      render();
    }catch(err){toast(apiErrorMessage(err));}
  };
  $('.modal-actions').prepend(deleteBtn);
}
// El contador lo manda el servidor; aca solo se pinta.
export function applyChatUnreadCount(count){
  {
    E.chatUnreadCount=count;
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
