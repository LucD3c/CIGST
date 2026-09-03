import { render } from './app.js';
import { page } from './armazon.js';
import { E } from './estado.js';
import { listFilters, openNew, toast, wireRecords } from './formularios.js';
import { employeesTable, equipmentTable, logbookTable, schedulesTable, sectorsTable, sortState, ticketsTable, usersTable, wireSorting } from './listas.js';
import { normalizeEmployee, normalizeEquipment, normalizeLogbookEntry, normalizeTicket, normalizeUser } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { equipment } from './util.js';

/* ---------- Paginacion del lado del servidor ----------
Antes cada listado se traia la tabla ENTERA y el navegador se encargaba de
filtrar, ordenar y contar. Con 26 tickets eso funciona; con quince mil son
varios megabytes por pantalla y por persona. Ahora el servidor manda de a una
pagina y dice cuantos hay en total, y el filtrado y el orden los resuelve la
base de datos, que para eso tiene los indices.

Las tablas chicas de catalogo (sectores y turnos) siguen siendo del lado del
cliente: son decenas de filas y no crecen con el uso. */
export const PAGINADAS = new Set(['tickets','employees','equipment','users','logbook']);
export const PAGE_SIZE = 50;

// Origen de cada listado paginado: ruta, clave de la respuesta y como se
// normaliza cada fila.
export const FUENTES = {
  tickets:   { url:'/tickets',   clave:'tickets',   norm:r=>normalizeTicket(r) },
  employees: { url:'/employees', clave:'employees', norm:r=>normalizeEmployee(r) },
  equipment: { url:'/equipment', clave:'equipment', norm:r=>normalizeEquipment(r) },
  users:     { url:'/users',     clave:'users',     norm:r=>normalizeUser(r) },
  logbook:   { url:'/logbook',   clave:'entries',   norm:r=>normalizeLogbookEntry(r) },
};

// Nombre de columna de la interfaz -> nombre que entiende el servidor. Solo se
// pueden pedir las columnas que el backend acepta explicitamente.
export const SORT_API = {
  tickets:   { code:'code', title:'title', person:'employee', priority:'priority', status:'status', technician:'technician' },
  employees: { name:'name', code:'code', email:'email', extension:'extension', sectorName:'sectorName', status:'status' },
  equipment: { model:'model', code:'code', type:'type', status:'status', sectorName:'sectorName' },
  users:     { name:'name', username:'username', status:'status', lastAccess:'lastAccessAt' },
  logbook:   { title:'title', code:'code', category:'category', date:'occurredAt' },
};

export const pager = {};
export const filtroTimers = {};
export function pagerDe(kind){
  if(!pager[kind])pager[kind]={page:1,pageSize:PAGE_SIZE,total:0,totalPaginas:1,cargando:false};
  return pager[kind];
}

// Trae una pagina del servidor y la deja en E.store[kind]. Devuelve false si algo
// fallo, para que quien llame pueda dejar la pantalla como estaba.
export async function cargarPagina(kind){
  const fuente=FUENTES[kind];
  if(!fuente)return false;
  const st=pagerDe(kind);
  const params=new URLSearchParams();
  params.set('page',String(st.page));
  params.set('pageSize',String(st.pageSize));
  const q=(listFilters[kind]||'').trim();
  if(q)params.set('q',q);
  const orden=sortState[kind];
  if(orden&&orden.col){
    const col=(SORT_API[kind]||{})[orden.col];
    if(col){params.set('sort',col);params.set('dir',orden.dir===1?'asc':'desc');}
  }
  if(kind==='tickets')params.set('estado',E.ticketStatusFilter);
  st.cargando=true;
  try{
    const res=await api(`${fuente.url}?${params.toString()}`);
    E.store[kind]=(res[fuente.clave]||[]).map(fuente.norm);
    st.total=res.total??E.store[kind].length;
    st.totalPaginas=res.totalPaginas??1;
    st.pageSize=res.pageSize??st.pageSize;
    // Si se borro el ultimo registro de la ultima pagina, se retrocede sola.
    if(st.page>st.totalPaginas&&st.totalPaginas>=1){st.page=st.totalPaginas;st.cargando=false;return cargarPagina(kind);}
    return true;
  }catch(err){
    toast(apiErrorMessage(err));
    return false;
  }finally{
    st.cargando=false;
  }
}

// Barra de paginado. No se dibuja si todo entra en una sola pagina: en una
// empresa recien instalada no tiene por que aparecer nada.
export function paginacionHtml(kind){
  const st=pagerDe(kind);
  if(st.totalPaginas<=1)return '';
  const desde=(st.page-1)*st.pageSize+1;
  const hasta=Math.min(st.page*st.pageSize,st.total);
  return `<div class="pager"><button class="btn btn-ghost" type="button" data-pager="${kind}" data-pager-dir="-1"${st.page<=1?' disabled':''}>‹ Anterior</button>`
    +`<span class="pager-info">${desde}–${hasta} de ${st.total}</span>`
    +`<button class="btn btn-ghost" type="button" data-pager="${kind}" data-pager-dir="1"${st.page>=st.totalPaginas?' disabled':''}>Siguiente ›</button></div>`;
}

export function wirePaginacion(root=document){
  root.querySelectorAll('[data-pager]').forEach(b=>b.onclick=async()=>{
    const kind=b.dataset.pager;
    const st=pagerDe(kind);
    const siguiente=st.page+Number(b.dataset.pagerDir);
    if(siguiente<1||siguiente>st.totalPaginas)return;
    st.page=siguiente;
    await refreshList(kind);
    // Al cambiar de pagina se vuelve arriba: si no, uno queda mirando el pie
    // de una tabla que ya cambio entera.
    document.querySelector('.content')?.scrollTo({top:0,behavior:'smooth'});
  });
}
// Todas las tablas que se redibujan solas al ordenar o filtrar. Si una tabla
// falta en este mapa, el encabezado se puede clickear pero la lista no se
// vuelve a dibujar: el orden cambia por dentro y no se ve.
export const tableRenderers = { tickets:ticketsTable, employees:employeesTable, equipment:equipmentTable, users:usersTable, sectors:sectorsTable, schedules:schedulesTable, logbook:logbookTable };

// Filas visibles de una lista.
//
// En las listas paginadas el filtrado y el orden ya los resolvio el servidor
// sobre el total de registros: volver a filtrar aca seria filtrar dentro de una
// sola pagina, que es justamente lo que NO hay que hacer (mostraria "los
// activos que hay entre los primeros 50" en vez de "los activos").
// Las tablas chicas de catalogo si se filtran en el navegador.
export function visibleRows(kind){
  if(PAGINADAS.has(kind))return E.store[kind]||[];
  let rows=E.store[kind]||[];
  const q=(listFilters[kind]||'').toLowerCase().trim();
  if(q)rows=rows.filter(x=>Object.values(x).join(' ').toLowerCase().includes(q));
  return rows;
}
// Vuelve a dibujar solo la tabla (sin recargar la vista entera): mantiene el
// foco en el buscador mientras se escribe.
export async function refreshList(kind){
  const container=document.getElementById(`${kind}-table`);
  const render=tableRenderers[kind];
  if(!container||!render)return;

  // Las listas paginadas piden su pagina al servidor antes de dibujar.
  if(PAGINADAS.has(kind)){
    const ok=await cargarPagina(kind);
    if(!ok)return;
  }

  const rows=visibleRows(kind);
  container.innerHTML=render(rows);
  wireRecords(container);
  wireSorting(container);

  const barra=document.getElementById(`${kind}-pager`);
  if(barra){barra.innerHTML=paginacionHtml(kind);wirePaginacion(barra);}

  const count=document.querySelector(`[data-count="${kind}"]`);
  if(count)count.textContent=textoConteo(kind);
}

// Texto del contador que va arriba de cada tabla.
export function textoConteo(kind){
  if(!PAGINADAS.has(kind))return `${(E.store[kind]||[]).length}`;
  const st=pagerDe(kind);
  const n=st.total;
  const etiquetas={tickets:'ticket',employees:'persona',equipment:'equipo o espacio',users:'usuario',logbook:'evento'};
  const singular=etiquetas[kind]||'registro';
  if(n===1)return `1 ${singular}`;
  const plural=singular==='persona'?'personas':singular==='equipo o espacio'?'equipos y espacios':`${singular}s`;
  return `${n} ${plural}`;
}
// Los tickets de una ficha (de una persona o de un equipo) los filtra la base
// de datos. Antes se filtraba sobre la lista que tenia cargada el navegador, y
// con paginacion eso mostraria solo los que casualmente estuvieran en la pagina
// que se tenia a mano: la ficha diria "sin tickets" teniendo veinte.
export async function cargarTicketsRelacionados(root=document){
  const cajas=[...root.querySelectorAll('[data-tickets-de]')];
  for(const caja of cajas){
    try{
      const res=await api(`/tickets?${caja.dataset.ticketsDe}&estado=todos&pageSize=50`);
      const filas=(res.tickets||[]).map(normalizeTicket);
      caja.innerHTML=ticketsTable(filas)+(res.total>filas.length?`<div class="pager"><span class="pager-info">Se muestran los ${filas.length} más recientes de ${res.total}.</span></div>`:'');
      wireRecords(caja);
    }catch{
      caja.innerHTML='<div class="empty">No se pudieron cargar los tickets relacionados.</div>';
    }
  }
}

export function wirePage(){
  document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>openNew(x.dataset.action.replace('new-','')));
  document.querySelectorAll('.filter').forEach(input=>{
    const kind=input.dataset.filter;
    input.value=listFilters[kind]||'';
    input.oninput=()=>{
      listFilters[kind]=input.value;
      if(PAGINADAS.has(kind)){
        // Se espera a que la persona deje de escribir antes de consultar: sin
        // esto se dispararia una consulta por cada tecla.
        pagerDe(kind).page=1;
        clearTimeout(filtroTimers[kind]);
        filtroTimers[kind]=setTimeout(()=>void refreshList(kind),280);
      }else{
        void refreshList(kind);
      }
    };
  });
  const statusFilter=document.getElementById('ticket-status-filter');
  if(statusFilter)statusFilter.onchange=()=>{E.ticketStatusFilter=statusFilter.value;pagerDe('tickets').page=1;void refreshList('tickets');};
  wireRecords();
  wireSorting();
  wirePaginacion();
  void cargarTicketsRelacionados();
}
