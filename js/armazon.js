import { render } from './app.js';
import { applySessionUser } from './datos.js';
import { E } from './estado.js';
import { feedAbiertos, feedComentarios } from './feed.js';
import { closeModal, globalSearch, modal, toast } from './formularios.js';
import { activity, ticketsTable } from './listas.js';
import { toggleNotifPanel } from './notificaciones.js';
import { $, api, apiErrorMessage, app } from './nucleo.js';
import { disconnectRealtime } from './tiemporeal.js';
import { badge, employee, esc, isAdmin, isStaff, navItems } from './util.js';

/* ---------- Vistas ---------- */
export function loginView(){app.innerHTML=`<main class="login-page"><section class="login-card"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span></div><h1>Centro de Soporte</h1><p>Ingresá con las credenciales proporcionadas por Sistemas.</p><form id="login-form"><div class="field"><label for="username">Usuario</label><input id="username" name="username" required autocomplete="username" autofocus /></div><div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" /></div><div class="login-actions" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Iniciar sesión</button></div></form></section></main>`;$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const submitBtn=e.currentTarget.querySelector('button[type=submit]');submitBtn.disabled=true;try{const {user}=await api('/auth/login',{method:'POST',body:{username:form.get('username'),password:form.get('password')}});applySessionUser(user);await render();}catch(err){toast(apiErrorMessage(err));}finally{submitBtn.disabled=false;}});}

/* ---------- Menu en pantallas chicas ----------
En el celular la barra lateral no entra al costado, asi que se esconde. Antes
se escondia y listo: no quedaba NINGUNA forma de navegar, uno entraba y se
quedaba encerrado en la pantalla en la que habia caido. Ahora se convierte en
un cajon que se abre con el boton de las tres rayas y se cierra al elegir una
opcion, al tocar afuera o con la tecla Escape. */
export function abrirNavMovil(){
  document.getElementById('layout')?.classList.add('nav-abierto');
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded','true');
}
export function cerrarNavMovil(){
  document.getElementById('layout')?.classList.remove('nav-abierto');
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded','false');
}
export function wireNavMovil(){
  const boton=document.getElementById('nav-toggle');
  const telon=document.getElementById('nav-backdrop');
  if(boton)boton.onclick=()=>{
    const abierto=document.getElementById('layout')?.classList.contains('nav-abierto');
    if(abierto)cerrarNavMovil();else abrirNavMovil();
  };
  if(telon)telon.onclick=cerrarNavMovil;
}

/* ---------- Mi dirección de red ----------
Para que sirve: cuando alguien llama a sistemas, lo primero que le preguntan es
"que IP tenes". Tenerla a mano evita explicarle por telefono como abrir una
consola, y le permite al tecnico conectarse por VNC.

Por que esta oculta por defecto: una IP interna es informacion de
infraestructura. No tiene por que estar a la vista mientras alguien comparte su
pantalla en una reunion o mientras pasa gente por detras del escritorio. Se
muestra solo cuando la persona la pide, y se vuelve a ocultar con el mismo
boton. Ademas se pide al servidor recien al apretarlo: si nunca se usa, la
direccion no viaja ni una vez. */
export let miIpCache=null;
export let miIpVisible=false;
export function ipBoxHtml(){
  return `<div class="ip-box"><button class="ip-btn" id="ip-toggle" type="button" title="Mostrar la dirección de red de esta computadora, para pasársela a sistemas">${miIpVisible?'Ocultar IP':'Mi IP'}</button><span class="ip-value${miIpVisible?'':' hidden'}" id="ip-value">${miIpCache?esc(miIpCache):''}</span></div>`;
}
export function wireIpPropia(){
  const boton=document.getElementById('ip-toggle');
  const valor=document.getElementById('ip-value');
  if(!boton||!valor)return;
  boton.onclick=async()=>{
    if(miIpVisible){
      miIpVisible=false;valor.classList.add('hidden');boton.textContent='Mi IP';return;
    }
    if(!miIpCache){
      boton.disabled=true;
      try{
        const {red}=await api('/auth/mi-ip');
        miIpCache=red&&red.ip?red.ip:'No se pudo determinar';
      }catch{
        miIpCache='No se pudo determinar';
      }finally{
        boton.disabled=false;
      }
    }
    valor.textContent=miIpCache;
    valor.classList.remove('hidden');
    miIpVisible=true;
    boton.textContent='Ocultar IP';
  };
  // Un clic en la direccion la copia: es lo que uno quiere hacer justo despues
  // de verla, para pegarla en un chat o en un visor de VNC.
  valor.onclick=async()=>{
    if(!miIpCache)return;
    try{await navigator.clipboard.writeText(miIpCache);toast('Dirección copiada.');}
    catch{ /* si el navegador no lo permite, no pasa nada: se puede leer igual */ }
  };
}

export function shell(content){const byId=ids=>navItems.filter(([id])=>ids.includes(id));const inicio=byId(['feed']);const operacion=byId(['dashboard','tickets']);const informacion=byId(['employees','equipment','sectors','knowledge']);const administracion=byId(['logbook','users']);const comunicacion=byId(['chat','mail']);const staffNav=`<div class="nav-group">Inicio</div>${inicio.map(nav).join('')}<div class="nav-group">Operación</div>${operacion.map(nav).join('')}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${informacion.map(nav).join('')}${isAdmin()?`<div class="nav-group">Administración</div>${administracion.map(nav).join('')}`:''}`;const employeeNav=`<div class="nav-group">Inicio</div>${inicio.map(nav).join('')}<div class="nav-group">Soporte</div>${nav(['employee-portal','◈','Mis solicitudes'])}<div class="nav-group">Comunicación</div>${comunicacion.map(nav).join('')}<div class="nav-group">Información</div>${nav(['knowledge','▦','Bases de conocimiento'])}`;const bellBadge=E.notifUnreadCount>0?`<span class="bell-badge">${E.notifUnreadCount>99?'99+':E.notifUnreadCount}</span>`:'';app.innerHTML=`<div class="layout" id="layout"><div class="nav-backdrop" id="nav-backdrop"></div><aside class="sidebar" id="sidebar"><div class="brand"><span class="brand-mark">C</span><span>CIGST</span><button class="bell" id="notif-bell" type="button" title="Notificaciones">🔔${bellBadge}</button></div><div id="notif-panel" class="notif-panel hidden"></div><nav class="nav">${isStaff()?staffNav:employeeNav}</nav><div class="sidebar-user"><strong>${esc(E.currentUser.name)}</strong><span>${esc(E.currentUser.role)}</span></div></aside><main class="main"><header class="topbar"><button class="nav-toggle" id="nav-toggle" type="button" aria-label="Abrir el menú" aria-expanded="false">☰</button>${isStaff()?`<div class="search"><span class="search-icon">⌕</span><input id="global-search" placeholder="Buscar personas, equipos, tickets, notas…" autocomplete="off"/><span class="key">Ctrl K</span></div>`:'<div class="brand"><span>Mis solicitudes de soporte</span></div>'}<div class="top-actions">${ipBoxHtml()}<span class="status-dot" title="Sistema operativo"></span><button class="btn btn-ghost" id="logout">Salir</button><div class="avatar">${E.currentUser.initials}</div></div></header><div class="content">${content}</div></main></div><div id="modal-root"></div>`;document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{cerrarNavMovil();E.currentView=el.dataset.view;E.currentDetailId=null;render();});wireNavMovil();
wireIpPropia();
$('#notif-bell').onclick=toggleNotifPanel;$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});}catch{ /* si falla la red, igual cerramos localmente */ }E.session=false;E.currentUser=null;disconnectRealtime();E.feedPosts=[];feedComentarios.clear();feedAbiertos.clear();E.kbSpaces=[];E.kbSpace=null;E.kbArticle=null;E.mailEstado=null;E.mailCuentas=[];E.mailCuentaActiva=null;E.mailCarpetas=[];E.mailMensajes=[];E.mailAbierto=null;E.chatConversations=[];E.chatGroups=[];E.activeChatConversationId=null;E.activeChatGroupId=null;E.chatMessages=[];E.chatUnreadCount=0;E.notifUnreadCount=0;render();};$('#global-search')?.addEventListener('input',e=>globalSearch(e.target.value));document.onkeydown=keyHandler;}
export const nav=([id,icon,label])=>{const badge=id==='chat'&&E.chatUnreadCount>0?`<span class="nav-badge">${E.chatUnreadCount>99?'99+':E.chatUnreadCount}</span>`:'';return `<button class="nav-item ${E.currentView===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;};
export function keyHandler(e){
  if(e.key==='Escape'&&document.getElementById('layout')?.classList.contains('nav-abierto')){cerrarNavMovil();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#global-search')?.focus();}if(e.key==='Escape'){closeModal();document.getElementById('notif-panel')?.classList.add('hidden');}}
export function page(title,subtitle,button=''){return `<div class="page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`}
// Tablero. Los cinco numeros de arriba los calcula Postgres con un GROUP BY
// indexado (ver /tickets/stats): antes el navegador se traia TODOS los tickets
// de la empresa solo para poder contarlos, cosa que a los pocos anios de uso
// significa bajar y recorrer miles de registros en cada visita al tablero.
export function dashboard(){
  const st=E.store.stats||{abiertos:0,criticos:0,enProceso:0,esperando:0,resueltos:0};
  const metrica=(clase,etiqueta,simbolo,valor,pie)=>`<div class="metric ${clase}"><div class="metric-label">${etiqueta} <span>${simbolo}</span></div><div class="metric-value">${valor}</div><div class="metric-meta">${pie}</div></div>`;
  return page('Centro de operaciones','Visión general del soporte técnico.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)
    +`<section class="metrics">`
      +metrica('','Abiertos','◈',st.abiertos,'requieren seguimiento')
      +metrica('urgent','Urgentes','!',st.criticos,'prioridad crítica')
      +metrica('live','En proceso','↗',st.enProceso,'con técnico asignado')
      +metrica('','Esperando','◷',st.esperando,'usuario o proveedor')
      +metrica('','Resueltos','✓',st.resueltos,'histórico registrado')
    +`</section>`
    +`<section class="grid"><div class="panel"><div class="panel-head"><h2>Tickets que requieren atención</h2><a data-view="tickets">Ver todos</a></div>${ticketsTable(E.store.tickets)}</div>`
    +`<div class="panel"><div class="panel-head"><h2>Actividad reciente</h2>${isAdmin()?'<a data-view="logbook">Bitácora</a>':''}</div><div class="activity">${E.store.activity.length?E.store.activity.map(activity).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'}</div></div></section>`
    +`<section class="two-panels"><div class="panel"><div class="panel-head"><h2>Eventos importantes</h2>${isAdmin()?'<a data-view="logbook">Ver bitácora</a>':''}</div>${isAdmin()?(E.store.logbook.length?E.store.logbook.slice(0,3).map(e=>`<div class="event"><strong>${esc(e.title)}</strong><span>${esc(e.category)} · ${e.date} · ${esc(e.author)}</span></div>`).join(''):'<div class="empty">No hay eventos técnicos registrados.</div>'):'<div class="empty">Solo visible para Administrador.</div>'}</div>`
    +`<div class="panel"><div class="panel-head"><h2>Recordatorios</h2></div><div class="empty">No hay recordatorios pendientes.</div></div></section>`;
}
