import { E } from './estado.js';
import { normalizeTicket } from './normalizar.js';
import { $, api } from './nucleo.js';

/* ---------- Utilidades de presentacion ---------- */
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
// Buscan primero en la pagina que se tiene a mano y, si no esta, en la lista
// completa de opciones (que viene entera de /tickets/form-options). Antes solo
// miraban el listado; ahora ese listado esta paginado, y quedarse solo con el
// haria que un nombre apareciera como "Sin persona" nada mas que porque su fila
// cayo en otra pagina.
export const employee = id => E.store.employees.find(x => x.id === id) || E.store.opcionesPersonas.find(x => x.id === id);
export const equipment = id => E.store.equipment.find(x => x.id === id) || E.store.opcionesEquipos.find(x => x.id === id);

// Trae un ticket por id: de la pagina cargada si esta, y si no del servidor.
// Hace falta porque a un ticket se llega tambien desde un aviso, desde el
// buscador o desde la ficha de una persona, y en esos casos puede no estar en
// la pagina que se tiene abierta.
export async function traerTicket(id){
  const enPagina=E.store.tickets.find(t=>t.id===id);
  if(enPagina)return enPagina;
  try{
    const {ticket}=await api(`/tickets/${id}`);
    return normalizeTicket(ticket);
  }catch{
    return null;
  }
}
export const statusClass = value => ({'Crítica':'b-red','Alta':'b-yellow','Nuevo':'b-blue','En proceso':'b-blue','Abierto':'b-blue','Esperando proveedor':'b-yellow','Esperando usuario':'b-yellow','Resuelto':'b-green','Cerrado':'b-green','Activo':'b-green','Inactivo':'b-gray','Bloqueado':'b-red','Baja':'b-gray','Media':'b-blue'}[value] || 'b-gray');
export const badge = value => `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
export const navItems = [ ['feed','◎','Novedades'], ['dashboard','⌂','Centro de operaciones'], ['tickets','◈','Tickets'], ['employees','♙','Personas'], ['equipment','▣','Equipos y espacios'], ['sectors','◫','Sectores'], ['knowledge','▦','Bases de conocimiento'], ['mail','✉','Correo'], ['logbook','▤','Bitácora técnica'], ['users','◉','Panel administrador'], ['chat','✉','Mensajes'] ];
// Equipos y tambien LUGARES: un ticket puede apuntar a una PC o a un
// consultorio/sala/puerta. Se carga solo lo que recibe pedidos, no un
// inventario exhaustivo de la empresa.
export const EQUIPMENT_TYPES = ['PC','Notebook','Monitor','Teclado','Mouse','Scanner','Impresora','UPS','Teléfono IP','Lector','Consultorio','Oficina','Sala','Depósito','Puerta','Instalación','Otro'];
export const isAdmin = () => E.currentUser?.role === 'Administrador';
export const isSupervisor = () => E.currentUser?.role === 'Supervisor';
export const isUser = () => E.currentUser?.role === 'User';
export const isStaff = () => E.currentUser?.role !== 'User';
