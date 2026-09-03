import { attachmentsHtml } from './adjuntos.js';
import { render } from './app.js';
import { page } from './armazon.js';
import { E } from './estado.js';
import { closeModal, field, modal, openEmployeeNew, select, toast } from './formularios.js';
import { formatDateTime, normalizeTicket } from './normalizar.js';
import { $, api, apiErrorMessage, handleApiError } from './nucleo.js';
import { PAGINADAS, pager, pagerDe, paginacionHtml, refreshList, textoConteo } from './paginacion.js';
import { badge, employee, equipment, esc, isAdmin, isStaff } from './util.js';

/* ---------- Ordenamiento de listas por columna ---------- */
// Cada lista recuerda por que columna esta ordenada y en que sentido. Se
// hace clic en el encabezado para ordenar y de nuevo para invertir.
export const sortState = {};
export const PRIORITY_RANK = { 'Crítica':0, 'Alta':1, 'Media':2, 'Baja':3 };
export const STATUS_RANK = { 'Nuevo':0, 'Abierto':1, 'En proceso':2, 'Esperando usuario':3, 'Esperando proveedor':4, 'Resuelto':5, 'Cerrado':6, 'Cancelado':7 };
// Valor por el que se compara cada columna (algunas no se ordenan alfabetico:
// prioridad y estado siguen su orden logico, no el del abecedario).
export function sortValue(kind,col,row){
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
export const textCompare=new Intl.Collator('es',{sensitivity:'base',numeric:true}).compare;
export function sortRows(kind,rows){
  // El orden de las listas paginadas lo resuelve Postgres con la colacion
  // espaniola, sobre el total de registros. Reordenar aca solo mezclaria las
  // filas de la pagina actual.
  if(PAGINADAS.has(kind))return rows;
  const s=sortState[kind];
  if(!s||!s.col)return rows;
  return [...rows].sort((a,b)=>{
    const va=sortValue(kind,s.col,a),vb=sortValue(kind,s.col,b);
    const d=(typeof va==='number'&&typeof vb==='number')?va-vb:textCompare(String(va),String(vb));
    return d*s.dir;
  });
}
// Encabezado clickeable con la flecha del sentido actual.
export function sortableTh(kind,col,label,extra=''){
  const s=sortState[kind];
  const active=s&&s.col===col;
  const arrow=active?(s.dir===1?' ▲':' ▼'):'';
  return `<th class="sortable ${active?'sorted':''}" data-sort-kind="${kind}" data-sort-col="${col}" ${extra} title="Ordenar por ${esc(label)}">${esc(label)}${arrow}</th>`;
}
export function wireSorting(root=document){
  root.querySelectorAll('[data-sort-col]').forEach(th=>th.onclick=()=>{
    const kind=th.dataset.sortKind,col=th.dataset.sortCol;
    const s=sortState[kind];
    sortState[kind]=(s&&s.col===col)?{col,dir:s.dir*-1}:{col,dir:1};
    // Al cambiar el orden se vuelve a la primera pagina: seguir en la pagina 7
    // de un orden distinto no significa nada.
    if(PAGINADAS.has(kind))pagerDe(kind).page=1;
    void refreshList(kind);
  });
}

export function ticketsTable(rows){const showActions=isStaff();return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('tickets','code','Ticket')}${sortableTh('tickets','title','Incidencia')}${sortableTh('tickets','person','Persona')}${sortableTh('tickets','priority','Prioridad')}${sortableTh('tickets','status','Estado')}${sortableTh('tickets','technician','Asignado')}${showActions?'<th></th>':''}</tr></thead><tbody>${sortRows('tickets',rows).map(t=>`<tr data-ticket="${t.id}"><td class="mono">${esc(t.code)}</td><td><strong>${esc(t.title)}</strong></td><td>${esc(t.employeeInfo?.name||employee(t.employee)?.name||'Sin persona')}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${esc(t.technician||'Sin asignar')}</td>${showActions?`<td class="row-actions"><button class="btn-icon" type="button" data-quick-menu="${t.id}" title="Acciones rápidas">⋮</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${showActions?7:6}" class="empty">No hay tickets en esta vista.</td></tr>`}</tbody></table></div>`}
export const activity=a=>`<div class="activity-item"><div class="activity-symbol">${a.icon}</div><div class="activity-copy">${a.text}</div><div class="activity-time">${a.time}</div></div>`;
// Filtro de estado de los tickets. Por defecto oculta los cerrados y
// cancelados: en el dia a dia lo que importa es lo que sigue abierto.
export const TICKET_STATUS_OPTIONS = [
  ['activos','Sin cerrados ni cancelados'],
  ['todos','Todos los estados'],
  ['Nuevo','Nuevo'],['Abierto','Abierto'],['En proceso','En proceso'],
  ['Esperando usuario','Esperando usuario'],['Esperando proveedor','Esperando proveedor'],
  ['Resuelto','Resuelto'],['Cerrado','Cerrado'],['Cancelado','Cancelado'],
];
export function ticketsMatchingStatus(rows){
  if(E.ticketStatusFilter==='todos')return rows;
  if(E.ticketStatusFilter==='activos')return rows.filter(t=>!['Cerrado','Cancelado'].includes(t.status));
  return rows.filter(t=>t.status===E.ticketStatusFilter);
}
export function ticketsView(){
  const opts=TICKET_STATUS_OPTIONS.map(([v,l])=>`<option value="${esc(v)}"${v===E.ticketStatusFilter?' selected':''}>${esc(l)}</option>`).join('');
  return page('Tickets','Registro y seguimiento de pedidos.',`<button class="btn btn-primary" data-action="new-ticket">+ Nuevo ticket</button>`)
    +`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, persona o número…" data-filter="tickets" />`
    +`<select class="list-select" id="ticket-status-filter" title="Filtrar por estado">${opts}</select>`
    +`<span class="list-count" data-count="tickets">${textoConteo('tickets')}</span></div>`
    +`<div class="panel" id="tickets-table">${ticketsTable(E.store.tickets)}</div>`
    +`<div id="tickets-pager">${paginacionHtml('tickets')}</div>`;
}
export function employeePortal(){const person=employee(E.currentUser.employeeId);return page('Solicitudes de soporte','Creá una solicitud para vos o para cualquier persona de la empresa.',`<button class="btn btn-primary" data-action="new-employee-ticket">+ Solicitar soporte</button>`)+`<section class="panel"><div class="panel-head"><h2>Mis solicitudes</h2><span class="muted">${esc(person?.sectorName||'')}</span></div>${ticketsTable(E.store.tickets)}</section><section class="panel" style="margin-top:18px"><div class="side-card"><h3>¿Necesitás ayuda?</h3><p class="muted">Describí el problema, elegí a quién hay que asistir (vos u otra persona), la prioridad y, si corresponde, el equipo. Sistemas recibirá la solicitud y actualizará el estado.</p></div></section>`}
export function employeesView(){return page('Personas','Ficha centralizada de colaboradores y su contexto técnico.',isAdmin()?`<button class="btn btn-primary" data-action="new-employee">+ Nueva persona</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre, correo, interno o sector…" data-filter="employees" /><span class="list-count" data-count="employees">${textoConteo('employees')}</span></div><div class="panel" id="employees-table">${employeesTable(E.store.employees)}</div><div id="employees-pager">${paginacionHtml('employees')}</div>`}
// Indicador de disponibilidad segun el horario laboral cargado. Lo calcula el
// servidor con la hora de la empresa, asi todos ven lo mismo.
export function workingBadge(x){
  if(x.workingStatus==='en-linea')return `<span class="badge b-green">En línea</span>`;
  if(x.workingStatus==='fuera-de-horario')return `<span class="badge b-gray">Fuera de horario</span>`;
  return `<span class="muted" style="font-size:11px">Sin horario</span>`;
}
export function workingRange(x){
  return x.workStartTime&&x.workEndTime?`${x.workStartTime}–${x.workEndTime}`:'';
}
export function employeesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('employees','name','Persona')}${sortableTh('employees','sectorName','Sector')}${sortableTh('employees','position','Cargo')}${sortableTh('employees','workStartTime','Horario')}${sortableTh('employees','workingStatus','Disponibilidad')}${sortableTh('employees','status','Estado')}</tr></thead><tbody>${sortRows('employees',rows).map(x=>`<tr data-employee="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.sectorName||'Sin sector')}</td><td>${esc(x.position)}</td><td class="mono">${esc(workingRange(x)||x.workShift||'—')}</td><td>${workingBadge(x)}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">No se encontraron personas.</td></tr>`}</tbody></table></div>`}
export function equipmentView(){return page('Equipos y espacios','Todo aquello sobre lo que se puede pedir ayuda: equipos, consultorios, salas, instalaciones.',isAdmin()?`<button class="btn btn-primary" data-action="new-equipment">+ Nuevo equipo o espacio</button>`:'')+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por código, tipo, nombre o sector…" data-filter="equipment" /><span class="list-count" data-count="equipment">${textoConteo('equipment')}</span></div><div class="panel" id="equipment-table">${equipmentTable(E.store.equipment)}</div><div id="equipment-pager">${paginacionHtml('equipment')}</div>`}
export function equipmentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('equipment','model','Equipo o espacio')}${sortableTh('equipment','type','Tipo')}${sortableTh('equipment','sectorName','Sector')}${sortableTh('equipment','status','Estado')}</tr></thead><tbody>${sortRows('equipment',rows).map(x=>`<tr data-equipment="${x.id}"><td><strong>${esc(x.model)||esc(x.type)}</strong><br><span class="muted mono">${esc(x.code)}</span></td><td>${esc(x.type)}</td><td>${esc(x.sectorName||'Sin sector')}</td><td>${badge(x.status)}</td></tr>`).join('')||`<tr><td colspan="4" class="empty">No se encontraron equipos ni espacios.</td></tr>`}</tbody></table></div>`}
export function logbookTable(rows){return rows.map(x=>`<div class="event"><div class="row-between"><strong>${esc(x.title)}</strong>${badge(x.category)}</div><span>${x.date} · ${esc(x.author)}</span><p class="muted">${esc(x.detail)}</p></div>`).join('')||'<div class="empty">No hay eventos registrados.</div>'}
export function logbookView(){return page('Bitácora técnica','Eventos relevantes y cambios de infraestructura.',`<button class="btn btn-primary" data-action="new-log">+ Registrar evento</button>`)+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por título, número o categoría…" data-filter="logbook" /><span class="list-count" data-count="logbook">${textoConteo('logbook')}</span></div><section class="panel" id="logbook-table">${logbookTable(E.store.logbook)}</section><div id="logbook-pager">${paginacionHtml('logbook')}</div>`}
export function usersTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('users','name','Usuario')}${sortableTh('users','role','Rol')}${sortableTh('users','status','Estado')}${sortableTh('users','lastAccess','Último acceso')}${sortableTh('users','logins','Ingresos')}</tr></thead><tbody>${sortRows('users',rows).map(x=>`<tr data-user="${x.id}"><td><strong>${esc(x.name)}</strong><br><span class="mono">${esc(x.username)}</span></td><td>${esc(x.role)}</td><td>${badge(x.status)}</td><td>${esc(x.lastAccess)}</td><td>${x.logins}</td></tr>`).join('')||`<tr><td colspan="5" class="empty">No hay usuarios.</td></tr>`}</tbody></table></div>`}
// Aviso de conexion sin cifrar.
//
// Cuando la plataforma se usa por HTTP plano, la contrasena y la cookie de
// sesion viajan legibles por la red de la empresa. El servidor ya lo deja
// anotado al arrancar, pero nadie mira los registros de Docker: el unico lugar
// donde esto se ve es la pantalla de un administrador.
//
// Se comprueba en el navegador, que es donde la diferencia es real. Se excluye
// localhost porque ahi el trafico no sale de la maquina.
function avisoConexionInsegura(){
  const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if(location.protocol === 'https:' || local) return '';
  return `<div class="aviso-fuerte"><strong>Esta conexión no está cifrada.</strong> `
    + `<span>La plataforma se está usando por HTTP, así que las contraseñas y la sesión viajan legibles `
    + `por la red de la empresa. Dentro de una red interna cerrada suele ser aceptable, pero si querés `
    + `cerrarlo del todo, la guía <span class="mono">docs/deployment-empresa.md</span> explica cómo poner `
    + `un servidor web adelante con certificado y activar <span class="mono">COOKIE_SECURE=true</span>.</span></div>`;
}

export function usersView(){return page('Panel administrador','Usuarios, roles y accesos de la plataforma.',`<button class="btn btn-primary" data-action="new-user">+ Crear usuario</button>`)+avisoConexionInsegura()+`<div class="list-toolbar"><input class="filter" placeholder="Filtrar por nombre o usuario…" data-filter="users" /><span class="list-count" data-count="users">${textoConteo('users')}</span></div><section class="panel" id="users-table">${usersTable(E.store.users)}</section><div id="users-pager">${paginacionHtml('users')}</div>`}
export function employeeDetail(x){return page('Ficha de persona','Contexto operativo unificado.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-employee="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.name)}</h2><p>${esc(x.position)} · ${esc(x.sectorName||'Sin sector')}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Correo</label>${esc(x.email)}</div><div class="info"><label>Interno</label>${esc(x.extension)}</div><div class="info"><label>Horario laboral</label>${esc(workingRange(x)||x.workShift||'No definido')} ${workingBadge(x)}</div><div class="info"><label>Reemplazo</label>${esc(x.replacementInfo?.name||'No definido')}</div></div></div><div class="panel-head"><h2>Tickets relacionados</h2></div><div data-tickets-de="employeeId=${x.id}"><div class="empty">Cargando…</div></div></section><aside><div class="panel side-card"><h3>Equipamiento del sector</h3>${x.sectorEquipment.map(e=>`<div class="event linkable" data-equipment="${e.id}"><strong>${esc(e.model)||esc(e.type)}</strong><span>${esc(e.type)} · ${badge(e.status)}</span></div>`).join('')||'<p class="muted">No hay equipamiento registrado en este sector.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Notas técnicas</h3>${x.notes?`<div class="note">${esc(x.notes)}</div>`:'<p class="muted">Sin observaciones registradas.</p>'}</div><div class="panel side-card" style="margin-top:18px"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía.</p>'}</div></aside></div>`}
export function equipmentDetail(x){return page('Detalle de equipamiento','Información, historial de cambios y tickets asociados.',isAdmin()?`<button class="btn btn-ghost" type="button" data-edit-equipment="${x.id}">Editar</button>`:'')+`<div class="detail"><section class="panel"><div class="detail-hero"><div class="row-between"><div><h2>${esc(x.model)||esc(x.type)}</h2><p>${esc(x.type)} · ${esc(x.code)}</p></div>${badge(x.status)}</div><div class="info-list"><div class="info"><label>Sector</label>${esc(x.sectorName||'Sin asignar')}</div></div></div><div class="panel-head"><h2>Tickets asociados</h2></div><div data-tickets-de="equipmentId=${x.id}"><div class="empty">Cargando…</div></div></section><aside><div class="panel side-card"><h3>Cambios</h3>${x.changeLog?`<div class="note changelog">${esc(x.changeLog)}</div>`:'<p class="muted">Sin cambios registrados todavía. Cada edición del equipo deja acá su historial automático.</p>'}</div></aside></div>`}
export function sectorsView(){return page('Sectores y turnos','Catálogo compartido por Personas, Equipos y Tickets.',isAdmin()?`<button class="btn btn-primary" data-action="new-sector">+ Nuevo sector</button>`:'')+`<div class="panel" id="sectors-table">${sectorsTable(E.store.sectors)}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Turnos de soporte</h2>${isAdmin()?'<button class="btn btn-ghost" data-action="new-schedule">+ Nuevo turno</button>':''}</div><div id="schedules-table">${schedulesTable(E.store.schedules)}</div></section>`}
export function sectorsTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('sectors','name','Sector')}${sortableTh('sectors','status','Estado')}</tr></thead><tbody>${sortRows('sectors',rows).map(s=>`<tr data-sector="${s.id}"><td><strong>${esc(s.name)}</strong></td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="2" class="empty">No hay sectores creados todavía.</td></tr>`}</tbody></table></div>`}
export function schedulesTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr>${sortableTh('schedules','name','Turno')}${sortableTh('schedules','startTime','Horario')}${sortableTh('schedules','status','Estado')}</tr></thead><tbody>${sortRows('schedules',rows).map(s=>`<tr data-schedule="${s.id}"><td><strong>${esc(s.name)}</strong></td><td class="mono">${esc(s.startTime)}–${esc(s.endTime)}</td><td>${badge(s.status)}</td></tr>`).join('')||`<tr><td colspan="3" class="empty">No hay turnos creados todavía.</td></tr>`}</tbody></table></div>`}
export function sectorDetail(x){
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
export function wireSectorCategories(){
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
export async function ticketDetail(listTicket){
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
  const technicians=E.store.technicians.map(x=>[x.id,x.name]);
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
export async function updateTicket(ticket, values){const payload={status:values.get('status'),priority:values.get('priority'),technicianId:values.get('technician')||'',solution:values.get('solution')||''};const {ticket:updated}=await api(`/tickets/${ticket.id}`,{method:'PATCH',body:payload});const normalized=normalizeTicket(updated);const idx=E.store.tickets.findIndex(t=>t.id===ticket.id);if(idx>=0)E.store.tickets[idx]=normalized;}
