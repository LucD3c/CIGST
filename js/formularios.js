import { attachmentField, wireAttachmentField } from './adjuntos.js';
import { render } from './app.js';
import { E } from './estado.js';
import { ticketDetail } from './listas.js';
import { normalizeEmployee, normalizeEquipment, normalizeLogbookEntry, normalizeSchedule, normalizeSector, normalizeTicket, normalizeUser } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { EQUIPMENT_TYPES, employee, equipment, esc, isAdmin, traerTicket } from './util.js';

/* ---------- Menu rapido de tickets (cerrar/resolver/asignarme sin abrir el detalle) ---------- */
export function openQuickMenu(button, ticketId){
  const rect=button.getBoundingClientRect();
  const root=$('#modal-root');
  const left=Math.min(rect.left,window.innerWidth-200);
  root.innerHTML=`<div class="quick-menu-backdrop" id="quick-menu-backdrop"></div><div class="quick-menu" style="top:${rect.bottom+6}px;left:${left}px"><button type="button" data-quick-action="resolve">✓ Marcar como Resuelto</button><button type="button" data-quick-action="close">✕ Cerrar ticket</button><button type="button" data-quick-action="assign">◈ Asignarme</button></div>`;
  $('#quick-menu-backdrop').onclick=closeModal;
  root.querySelectorAll('[data-quick-action]').forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.quickAction;
    const payload=action==='resolve'?{status:'Resuelto'}:action==='close'?{status:'Cerrado'}:{technicianId:E.currentUser.id};
    closeModal();
    try{
      const {ticket:updated}=await api(`/tickets/${ticketId}`,{method:'PATCH',body:payload});
      const idx=E.store.tickets.findIndex(t=>t.id===ticketId);
      if(idx>=0)E.store.tickets[idx]=normalizeTicket(updated);
      toast('Ticket actualizado.');
      render();
    }catch(err){toast(apiErrorMessage(err));}
  });
}

export let searchDebounce;
export function globalSearch(query){clearTimeout(searchDebounce);const q=query.trim();const root=$('#modal-root');if(!q){root.innerHTML='';return;}searchDebounce=setTimeout(()=>runGlobalSearch(q),250);}
export async function runGlobalSearch(q){const root=$('#modal-root');try{const [peopleRes,equipRes,ticketsRes]=await Promise.all([api(`/employees?q=${encodeURIComponent(q)}`),api(`/equipment?q=${encodeURIComponent(q)}`),api(`/tickets?q=${encodeURIComponent(q)}`)]);const people=peopleRes.employees.map(normalizeEmployee);const equips=equipRes.equipment.map(normalizeEquipment);const tickets=ticketsRes.tickets.map(normalizeTicket);root.innerHTML=`<div class="modal-backdrop" style="align-items:start;padding-top:78px" id="search-overlay"><div class="modal"><div class="modal-body" style="padding-top:18px"><div class="result-group"><h3>Personas (${people.length})</h3>${people.map(x=>`<div class="result" data-employee="${x.id}"><div class="result-icon">♙</div><div><strong>${esc(x.name)}</strong><span>${esc(x.sectorName)} · int. ${esc(x.extension)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Equipamiento (${equips.length})</h3>${equips.map(x=>`<div class="result" data-equipment="${x.id}"><div class="result-icon">▣</div><div><strong>${esc(x.model)||esc(x.type)}</strong><span>${esc(x.type)} · ${esc(x.sectorName||'Sin sector')}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div><div class="result-group"><h3>Tickets (${tickets.length})</h3>${tickets.map(x=>`<div class="result" data-ticket="${x.id}"><div class="result-icon">◈</div><div><strong>${esc(x.code)} · ${esc(x.title)}</strong><span>${esc(x.status)} · ${esc(x.technician)}</span></div></div>`).join('')||'<div class="muted">Sin coincidencias.</div>'}</div></div></div></div>`;wireRecords(root);}catch{ /* si la busqueda falla, se deja el overlay como estaba */ }}
export function closeModal(){const root=$('#modal-root');if(root)root.innerHTML='';}
export function modal(title,fields,onSubmit){$('#modal-root').innerHTML=`<div class="modal-backdrop"><form class="modal" id="entry-form"><div class="modal-head"><h2>${title}</h2><button class="close" type="button">×</button></div><div class="modal-body"><div class="form-grid">${fields}</div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></div></form></div>`;$('.close').onclick=closeModal;$('[data-close]').onclick=closeModal;const form=$('#entry-form');form.onsubmit=async e=>{e.preventDefault();const submitBtn=form.querySelector('button[type=submit]');const values=new FormData(form);submitBtn.disabled=true;try{await onSubmit(values);closeModal();toast('Registro guardado correctamente.');render();}catch(err){toast(apiErrorMessage(err));submitBtn.disabled=false;}};}
export const field=(name,label,type='text',extra='')=>`<div class="field ${extra}"><label>${label}</label>${type==='textarea'?`<textarea name="${name}"></textarea>`:`<input name="${name}" type="${type}" required />`}</div>`;
export const requiredTextArea=(name,label,extra='')=>`<div class="field ${extra}"><label>${label}</label><textarea name="${name}" required></textarea></div>`;
// Campo de texto que se puede dejar vacio, con una linea de ayuda debajo.
export const textOpcional=(name,label,value='',ayuda='',placeholder='')=>`<div class="field"><label>${label}</label><input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" /><span class="field-help">${esc(ayuda)}</span></div>`;
export const textValue=(name,label,value='',extra='')=>`<div class="field ${extra}"><label>${label}</label><input name="${name}" value="${esc(value)}" required /></div>`;

/* ---------- Sector: desplegable compartido (se crea/administra desde su propia pantalla) ---------- */
export function sectorSelectOptions(selectedId,emptyLabel='Sin definir'){
  const sorted=E.store.sectors.map(s=>[s.id,s.name]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'es',{sensitivity:'base'}));
  const opts=[['',emptyLabel],...sorted];
  return opts.map(([v,l])=>`<option value="${esc(v)}"${v===selectedId?' selected':''}>${esc(l)}</option>`).join('');
}
export const sectorField=(selectedId='',label='Sector',emptyLabel='Sin definir')=>`<div class="field"><label>${label}</label><select name="sectorId">${sectorSelectOptions(selectedId,emptyLabel)}</select></div>`;

// Categorias del sector elegido: cada sector define las suyas desde su propia
// pantalla, asi que la lista cambia con el desplegable de Sector.
export function categoriesForSector(sectorId){
  return E.store.categories.filter(c=>c.sectorId===sectorId).map(c=>c.name)
    .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
}
export function categoryOptionsHtml(sectorId){
  const names=categoriesForSector(sectorId);
  if(!names.length)return `<option value="">${esc(sectorId?'Este sector no tiene categorías cargadas':'Elegí primero el sector a requerir')}</option>`;
  return names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
}
export const byName=(a,b)=>String(a[1]).localeCompare(String(b[1]),'es',{sensitivity:'base'});
export function ticketFields(defaultPersonId=''){
  const equipmentOptions=[['','No corresponde'],...E.store.opcionesEquipos.map(x=>[x.id,`${x.model||x.type} · ${x.type}`]).sort(byName)];
  // Recien instalada la plataforma todavia no hay personas cargadas: en vez de
  // un desplegable vacio (que parece roto) se dice que falta cargarlas. El
  // ticket igual se puede crear: la persona es opcional.
  const peopleOptions=E.store.opcionesPersonas.length
    ? E.store.opcionesPersonas.map(x=>[x.id,`${x.name} · ${x.sectorName||'Sin sector'}`]).sort(byName)
    : [['','Todavía no hay personas cargadas']];
  const scheduleOptions=[['','No indicado'],...E.store.schedules.map(s=>[s.id,`${s.name} · ${s.startTime}–${s.endTime}`]).sort(byName)];
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
export async function createTicket(values,attachIds){const payload={title:values.get('title'),description:values.get('description'),employeeId:values.get('employee')||'',requestedById:values.get('requestedBy')||'',equipmentId:values.get('equipment')||'',sectorId:values.get('sectorId')||'',scheduleId:values.get('scheduleId')||'',category:values.get('category')||'',priority:values.get('priority'),attachmentIds:attachIds||[]};const {ticket}=await api('/tickets',{method:'POST',body:payload});E.store.tickets.unshift(normalizeTicket(ticket));}
// Al elegir el SECTOR A REQUERIR, la lista de categorias se rearma con las
// que definio ese sector. El sector ya no se deduce del equipo ni de la
// persona: son cosas distintas (donde esta el equipo vs. a quien le pido
// ayuda), y mezclarlas ofrecia categorias que no correspondian.
export function wireTicketFormAutoselect(){
  const form=$('#entry-form');
  if(!form)return;
  const sectorSel=form.elements.sectorId;
  const catSel=form.elements.category;
  const refreshCategories=()=>{ if(catSel&&sectorSel)catSel.innerHTML=categoryOptionsHtml(sectorSel.value); };
  sectorSel?.addEventListener('change',refreshCategories);
  refreshCategories();
}
export function openNew(kind){
 if(kind==='ticket'){let att;modal('Nuevo ticket',ticketFields(''),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee-ticket'){let att;modal('Solicitar soporte',ticketFields(E.currentUser.employeeId),f=>createTicket(f,att.ids()));wireTicketFormAutoselect();att=wireAttachmentField('ticket-attach');}
 if(kind==='employee')openEmployeeNew();
 if(kind==='equipment')modal('Nuevo equipo o espacio',
    select('type','Tipo',EQUIPMENT_TYPES)
    +field('model','Nombre o identificación')
    +textOpcional('code','Código','','Si lo dejás vacío, la plataforma le pone uno (EQ-001, EQ-002…). Si tu empresa ya usa etiquetas de inventario, escribí la tuya.','Por ejemplo: PC-RECEP-04')
    +sectorField(),
  async f=>{
    const payload={type:f.get('type'),model:f.get('model'),code:(f.get('code')||'').trim(),sectorId:f.get('sectorId')||''};
    await api('/equipment',{method:'POST',body:payload});
  });
 if(kind==='log')modal('Registrar evento',field('title','Título','text','form-span')+select('category','Categoría',['Mantenimiento','Infraestructura','Seguridad','Cambio','Actualización'])+field('detail','Detalle técnico','textarea','form-span'),async f=>{const payload={title:f.get('title'),category:f.get('category'),detail:f.get('detail')};const {entry}=await api('/logbook',{method:'POST',body:payload});E.store.logbook.unshift(normalizeLogbookEntry(entry));});
 if(kind==='user')modal('Crear usuario',field('name','Nombre completo')+field('username','Usuario')+field('password','Contraseña inicial','password')+`<p class="field-help form-span">${esc(AYUDA_CONTRASENA)}</p>`+select('role','Rol',['Administrador','Supervisor','User'])+select('employee','Persona vinculada',[['','No aplica'],...E.store.opcionesPersonas.map(x=>[x.id,x.name]).sort(byName)]),async f=>{const payload={name:f.get('name'),username:f.get('username'),password:f.get('password'),role:f.get('role'),employeeId:f.get('role')==='User'?(f.get('employee')||''):''};const {user:created}=await api('/users',{method:'POST',body:payload});E.store.users.push(normalizeUser(created));});
 if(kind==='sector')modal('Nuevo sector',field('name','Nombre del sector'),async f=>{const {sector:created}=await api('/sectors',{method:'POST',body:{name:f.get('name')}});E.store.sectors.push(normalizeSector(created));});
 if(kind==='schedule')modal('Nuevo turno',field('name','Nombre del turno')+textValue('startTime','Inicio (HH:MM)','')+textValue('endTime','Fin (HH:MM)',''),async f=>{const {schedule:created}=await api('/schedules',{method:'POST',body:{name:f.get('name'),startTime:f.get('startTime'),endTime:f.get('endTime')}});E.store.schedules.push(normalizeSchedule(created));});
}

/* ---------- Personas y Equipos: alta, edicion y baja (solo Admin) ---------- */
// Campos de hora reales (no texto libre): con esto la plataforma calcula sola
// si la persona esta dentro de su horario ahora mismo.
export const timeField=(name,label,value='')=>`<div class="field"><label>${label}</label><input name="${name}" type="time" value="${esc(value||'')}" /></div>`;
export const peopleOptionsSorted=(excludeId='')=>E.store.opcionesPersonas.filter(x=>x.id!==excludeId).map(x=>[x.id,x.name]).sort(byName);

export function employeeFormFields(x={}){
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
export function employeePayload(f){
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
export function relaxOptionalFields(){
  ['email','position','extension','phone'].forEach(n=>{const el=$('#entry-form')?.elements[n];if(el)el.required=false;});
}
// defaultSectorId permite dar de alta una persona ya ubicada en un sector,
// desde la pantalla de ese sector.
export function openEmployeeNew(defaultSectorId=''){
  modal('Nueva persona',employeeFormFields({sectorId:defaultSectorId}),async f=>{
    const {employee:created}=await api('/employees',{method:'POST',body:employeePayload(f)});
    E.store.employees.push(normalizeEmployee(created));
  });
  relaxOptionalFields();
}
export async function openEmployeeEdit(id){
  // Puede abrirse desde la ficha de la persona, a la que se llega sin pasar por
  // el listado: si no esta en la pagina cargada, se la pide al servidor.
  let x=E.store.employees.find(e=>e.id===id);
  if(!x){
    try{const res=await api(`/employees/${id}`);x=normalizeEmployee(res.employee);}
    catch(err){toast(apiErrorMessage(err));return;}
  }
  modal(`Editar ${x.name}`,employeeFormFields(x),async f=>{
    const payload={...employeePayload(f),status:f.get('status')};
    const {employee:updated}=await api(`/employees/${x.id}`,{method:'PATCH',body:payload});
    const idx=E.store.employees.findIndex(e=>e.id===x.id);
    if(idx>=0)E.store.employees[idx]=normalizeEmployee(updated);
  });
  relaxOptionalFields();
  addDeleteButton(`¿Eliminar a ${x.name}? Sus tickets se conservan, pero deja de aparecer en los listados.`,
    `/employees/${x.id}`,'Persona eliminada.','employees');
}
export async function openEquipmentEdit(id){
  // Se pide la ficha completa: el listado esta paginado y la lista de opciones
  // de los desplegables no trae el codigo ni el estado, que son justo dos de
  // los campos de este formulario.
  let x=E.store.equipment.find(e=>e.id===id);
  if(!x||!x.code){
    try{const res=await api(`/equipment/${id}`);x=normalizeEquipment(res.equipment);}
    catch(err){toast(apiErrorMessage(err));return;}
  }
  const fields=select('type','Tipo',EQUIPMENT_TYPES,x.type)
    +textValue('model','Nombre o identificación',x.model)
    +textValue('code','Código',x.code)
    +sectorField(x.sectorId,'Sector donde está')
    +select('status','Estado',['Activo','Inactivo'],x.status);
  modal(`Editar ${x.model||x.type}`,fields,async f=>{
    const payload={type:f.get('type'),model:f.get('model'),code:(f.get('code')||'').trim(),sectorId:f.get('sectorId')||'',status:f.get('status')};
    const {equipment:updated}=await api(`/equipment/${x.id}`,{method:'PATCH',body:payload});
    const idx=E.store.equipment.findIndex(e=>e.id===x.id);
    if(idx>=0)E.store.equipment[idx]=normalizeEquipment(updated);
  });
  addDeleteButton(`¿Eliminar "${x.model||x.type}"? Los tickets que lo mencionan se conservan.`,
    `/equipment/${x.id}`,'Equipo o espacio eliminado.','equipment');
}
// Boton rojo de eliminar dentro de un modal ya abierto (solo Admin).
export function addDeleteButton(confirmText,endpoint,okMessage,backToView){
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
      if(backToView&&E.currentView.endsWith('-detail')){E.currentView=backToView;E.currentDetailId=null;}
      render();
    }catch(err){toast(apiErrorMessage(err));}
  };
  actions.prepend(btn);
}

/* ---------- Panel administrador: editar/eliminar usuarios ---------- */
export function openUserEdit(id){
  const u=E.store.users.find(x=>x.id===id);
  if(!u)return;
  const isSelf=E.currentUser.id===id;
  const fields=textValue('name','Nombre completo',u.name)
    +select('role','Rol',['Administrador','Supervisor','User'])
    +select('employee','Persona vinculada',[['','No aplica'],...E.store.opcionesPersonas.map(x=>[x.id,x.name]).sort(byName)])
    +select('status','Estado',['Activo','Inactivo'])
    +`<div class="field form-span"><label>Nueva contraseña (opcional)</label><input name="password" type="password" placeholder="Dejar en blanco para no cambiarla" autocomplete="new-password" /><span class="field-help">${esc(AYUDA_CONTRASENA)}</span></div>`
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
export async function updateUser(u,values){
  const password=values.get('password');
  const payload={name:values.get('name'),role:values.get('role'),employeeId:values.get('employee')||'',status:values.get('status')};
  if(password)payload.password=password;
  const {user:updated}=await api(`/users/${u.id}`,{method:'PATCH',body:payload});
  const idx=E.store.users.findIndex(x=>x.id===u.id);
  if(idx>=0)E.store.users[idx]=normalizeUser(updated);
}
export async function removeUser(u){
  if(!window.confirm(`¿Eliminar definitivamente a ${u.name}? Esta acción no se puede deshacer.`))return;
  try{
    await api(`/users/${u.id}`,{method:'DELETE'});
    closeModal();
    toast('Usuario eliminado.');
    render();
  }catch(err){toast(apiErrorMessage(err));}
}

/* ---------- Sectores y Horarios: editar/eliminar ---------- */
export function openSectorEdit(id){
  const s=E.store.sectors.find(x=>x.id===id);
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
export async function updateSector(s,values){
  const {sector:updated}=await api(`/sectors/${s.id}`,{method:'PATCH',body:{name:values.get('name'),status:values.get('status')}});
  const idx=E.store.sectors.findIndex(x=>x.id===s.id);
  if(idx>=0)E.store.sectors[idx]=normalizeSector(updated);
}
export async function removeSector(s){
  if(!window.confirm(`¿Eliminar el sector "${s.name}"? Las personas y equipos que lo tenían asignado quedarán sin sector.`))return;
  try{
    await api(`/sectors/${s.id}`,{method:'DELETE'});
    closeModal();
    toast('Sector eliminado.');
    E.currentView='sectors';
    render();
  }catch(err){toast(apiErrorMessage(err));}
}
export function openScheduleEdit(id){
  const s=E.store.schedules.find(x=>x.id===id);
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
export async function updateSchedule(s,values){
  const {schedule:updated}=await api(`/schedules/${s.id}`,{method:'PATCH',body:{name:values.get('name'),startTime:values.get('startTime'),endTime:values.get('endTime'),status:values.get('status')}});
  const idx=E.store.schedules.findIndex(x=>x.id===s.id);
  if(idx>=0)E.store.schedules[idx]=normalizeSchedule(updated);
}
export async function removeSchedule(s){
  if(!window.confirm(`¿Eliminar el turno "${s.name}"?`))return;
  try{
    await api(`/schedules/${s.id}`,{method:'DELETE'});
    closeModal();
    toast('Turno eliminado.');
    render();
  }catch(err){toast(apiErrorMessage(err));}
}

export function select(name,label,items,selected){return `<div class="field"><label>${label}</label><select name="${name}">${items.map(x=>{const v=Array.isArray(x)?x[0]:x;const l=Array.isArray(x)?x[1]:x;const sel=selected!==undefined&&String(v)===String(selected)?' selected':'';return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;}).join('')}</select></div>`}
// Ventana de solo lectura: muestra algo y se cierra. No lleva formulario, asi
// que no reusa modal(), que siempre espera un guardado.
export function modalInfo(titulo,html){
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${esc(titulo)}</h2>`
    +`<button class="close" type="button">×</button></div><div class="modal-body">${html}</div></div></div>`;
  $('.close').onclick=closeModal;
  $('.modal-backdrop').onclick=e=>{if(e.target===$('.modal-backdrop'))closeModal();};
}
export function toast(message){const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),3000);}
export function wireRecords(root=document){
  root.querySelectorAll('[data-employee]').forEach(x=>x.onclick=e=>{e.stopPropagation();E.currentView='employee-detail';render(x.dataset.employee);});
  root.querySelectorAll('[data-equipment]').forEach(x=>x.onclick=e=>{e.stopPropagation();E.currentView='equipment-detail';render(x.dataset.equipment);});
  root.querySelectorAll('[data-ticket]').forEach(x=>x.onclick=async e=>{
    e.stopPropagation();
    const ticket=await traerTicket(x.dataset.ticket);
    if(ticket)ticketDetail(ticket);
    else toast('Ese ticket ya no está disponible.');
  });
  root.querySelectorAll('[data-view-link]').forEach(x=>x.onclick=e=>{e.stopPropagation();E.currentView=x.dataset.viewLink;E.currentDetailId=null;render();});
  root.querySelectorAll('[data-user]').forEach(x=>x.onclick=()=>openUserEdit(x.dataset.user));
  root.querySelectorAll('[data-quick-menu]').forEach(x=>x.onclick=e=>{e.stopPropagation();openQuickMenu(x,x.dataset.quickMenu);});
  root.querySelectorAll('[data-sector]').forEach(x=>x.onclick=()=>{E.currentView='sector-detail';render(x.dataset.sector);});
  // Editar turnos/sectores/personas/equipos: solo Admin (Supervisor solo mira).
  if(isAdmin()){
    root.querySelectorAll('[data-schedule]').forEach(x=>x.onclick=()=>openScheduleEdit(x.dataset.schedule));
    root.querySelectorAll('[data-edit-sector]').forEach(x=>x.onclick=()=>openSectorEdit(x.dataset.editSector));
    root.querySelectorAll('[data-edit-employee]').forEach(x=>x.onclick=()=>openEmployeeEdit(x.dataset.editEmployee));
    root.querySelectorAll('[data-edit-equipment]').forEach(x=>x.onclick=()=>openEquipmentEdit(x.dataset.editEquipment));
  }
}
// Texto escrito en cada filtro, para no perderlo al reordenar la lista.
// Se repite del lado del servidor en utils/passwordPolicy.ts, que es donde se
// valida de verdad. Esto es solo el texto que ve la persona ANTES de escribir:
// decirle que se espera evita que pruebe cinco veces y termine eligiendo la
// contrasena mas facil que el sistema le acepte.
export const AYUDA_CONTRASENA = 'Mínimo 10 caracteres, combinando al menos tres de: minúsculas, mayúsculas, números y símbolos. Sin secuencias tipo 1234 ni letras repetidas. Una frase con un número y un guion funciona muy bien (por ejemplo: Roble-Verde-72).';

export const listFilters = { tickets:'', employees:'', equipment:'', users:'', logbook:'' };
