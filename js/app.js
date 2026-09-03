import { dashboard, loginView, shell } from './armazon.js';
import { chatView, wireChatView } from './chat.js';
import { kbView, loadKbSpaces, wireKb } from './conocimiento.js';
import { loadMailCarpetas, loadMailCuentas, loadMailEstado, loadMailMensajes, mailView, wireMail } from './correo.js';
import { applySessionUser, loadCatalogos, loadEmployeeData, loadStaffData } from './datos.js';
import { E } from './estado.js';
import { feedView, loadFeed, wireFeed } from './feed.js';
import { employeeDetail, employeePortal, employeesView, equipmentDetail, equipmentView, logbookView, sectorDetail, sectorsView, ticketsView, usersView, wireSectorCategories } from './listas.js';
import { normalizeEmployee, normalizeEquipment, normalizeSector } from './normalizar.js';
import { $, api, handleApiError } from './nucleo.js';
import { pagerDe, refreshList, wirePage } from './paginacion.js';
import { employee, equipment, isAdmin, isStaff } from './util.js';
import { sortState } from './listas.js';

/* ---------- Router ---------- */
export async function render(id){
  if(!E.session){loginView();return;}
  // Las vistas de detalle recuerdan su registro: un re-render sin argumento
  // (tras guardar un cambio, cerrar un ticket, etc.) reusa el ultimo id.
  if(id===undefined)id=E.currentDetailId||undefined;
  E.currentDetailId=id||null;

  if(!isStaff()){
    // El rango User tambien entra a Novedades y a las Bases de conocimiento:
    // no son herramientas de soporte, son informacion de la empresa.
    const permitidas=['chat','feed','knowledge','mail'];
    if(!permitidas.includes(E.currentView))E.currentView='employee-portal';
    let content;
    try{
      if(E.currentView==='chat'){content=await chatView();}
      else if(E.currentView==='feed'){await loadFeed(true);content=feedView();}
      else if(E.currentView==='knowledge'){if(!E.kbSpace)await loadKbSpaces();content=kbView();}
      else if(E.currentView==='mail'){await loadMailEstado();if(E.mailEstado.disponible&&!E.mailCuentas.length)await loadMailCuentas();content=mailView();}
      else{await loadEmployeeData();content=employeePortal();}
    }catch(err){handleApiError(err);return;}
    shell(content);wirePage();
    if(E.currentView==='chat')wireChatView();
    if(E.currentView==='feed')wireFeed();
    if(E.currentView==='knowledge')wireKb();
    if(E.currentView==='mail')wireMail();
    return;
  }
  if(E.currentView==='users'&&!isAdmin())E.currentView='dashboard';
  if(E.currentView==='logbook'&&!isAdmin())E.currentView='dashboard';
  try{
    if(!['chat','feed','knowledge'].includes(E.currentView))await loadStaffData(E.currentView);
    if(E.currentView==='feed'){await loadCatalogos();await loadFeed(true);}
    if(E.currentView==='knowledge'&&!E.kbSpace)await loadKbSpaces();
    if(E.currentView==='mail'){
      await loadMailEstado();
      if(E.mailEstado.disponible){
        if(!E.mailCuentas.length)await loadMailCuentas();
        if(E.mailCuentaActiva&&!E.mailCarpetas.length){await loadMailCarpetas();await loadMailMensajes();}
      }
    }
  }catch(err){handleApiError(err);return;}
  let content;
  switch(E.currentView){
    case 'tickets':content=ticketsView();break;
    case 'employees':content=employeesView();break;
    case 'equipment':content=equipmentView();break;
    case 'sectors':content=sectorsView();break;
    case 'logbook':content=logbookView();break;
    case 'users':content=usersView();break;
    case 'chat':content=await chatView();break;
    case 'feed':content=feedView();break;
    case 'knowledge':content=kbView();break;
    case 'mail':content=mailView();break;
    case 'employee-detail':{
      if(!id){E.currentView='employees';content=employeesView();break;}
      let detail;
      try{const res=await api(`/employees/${id}`);detail=normalizeEmployee(res.employee);}
      catch(err){handleApiError(err);return;}
      content=employeeDetail(detail);
      break;
    }
    case 'equipment-detail':{
      // Se pide al servidor en vez de buscarlo en el listado: con paginacion,
      // el equipo puede perfectamente no estar en la pagina que se tiene
      // cargada (por ejemplo si se llego desde un ticket o desde el buscador).
      if(!id){E.currentView='equipment';content=equipmentView();break;}
      let detalle;
      try{const res=await api(`/equipment/${id}`);detalle=normalizeEquipment(res.equipment);}
      catch(err){handleApiError(err);return;}
      content=equipmentDetail(detalle);
      break;
    }
    case 'sector-detail':{
      if(!id){E.currentView='sectors';content=sectorsView();break;}
      let detail;
      try{const res=await api(`/sectors/${id}`);detail=normalizeSector(res.sector);}
      catch(err){handleApiError(err);return;}
      content=sectorDetail(detail);
      break;
    }
    default:content=dashboard();
  }
  shell(content);wirePage();
  if(E.currentView==='chat')wireChatView();
  if(E.currentView==='feed')wireFeed();
  if(E.currentView==='knowledge')wireKb();
  if(E.currentView==='mail')wireMail();
  if(E.currentView==='sector-detail')wireSectorCategories();
}

(async function bootstrap(){
  try{const {user}=await api('/auth/me');applySessionUser(user);}
  catch{E.session=false;E.currentUser=null;}
  render();
})();

/* Superficie de pruebas.

Con modulos ES nada queda colgado del objeto global, que es justamente lo que se
busca. Pero las pruebas automatizadas necesitan poder empujar la interfaz a
estados que a mano costaria armar (por ejemplo, forzar paginas de tres filas
para ejercitar el paginador sin tener que cargar doscientas personas).

Esto expone unicamente lo necesario para eso. No es una via de acceso a nada:
cualquier codigo que corra en la pagina ya podria llamar a estas funciones de
todos modos, porque vive en el mismo origen. */
window.CIGST = { E, render, refreshList, pagerDe, sortState, api };
