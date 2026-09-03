import { E } from './estado.js';
import { wireRecords } from './formularios.js';
import { normalizeSchedule, normalizeSector, normalizeTicket } from './normalizar.js';
import { startRealtime } from './notificaciones.js';
import { $, api } from './nucleo.js';
import { cargarPagina } from './paginacion.js';
import { employee, equipment, esc, isAdmin } from './util.js';

/* ---------- Carga de datos por sesion/vista ---------- */
export function applySessionUser(user) {
  E.currentUser = { id: user.id, name: user.name, role: user.role, employeeId: user.employeeId || '', initials: user.name.split(' ').map(x => x[0]).slice(0, 2).join('') };
  E.session = true;
  E.chatConversations = []; E.chatGroups = []; E.activeChatConversationId = null; E.activeChatGroupId = null;
  E.chatMessages = []; E.chatUnreadCount = 0; E.notifUnreadCount = 0; E.currentDetailId = null;
  startRealtime();
  E.currentView = 'feed';
}
// Catalogos chicos que necesitan los formularios (tecnicos, sectores, turnos,
// categorias). No crecen con el uso y se piden una sola vez por sesion, no en
// cada cambio de pantalla como antes.
export let catalogosCargados = false;
export async function loadCatalogos(forzar = false) {
  if (catalogosCargados && !forzar) return;
  const [techniciansRes, sectorsRes, schedulesRes, options] = await Promise.all([
    api('/users/technicians'), api('/sectors'), api('/schedules'), api('/tickets/form-options'),
  ]);
  E.store.technicians = techniciansRes.technicians;
  E.store.sectors = sectorsRes.sectors.map(normalizeSector);
  E.store.schedules = schedulesRes.schedules.map(normalizeSchedule);
  E.store.categories = options.categories || [];
  E.store.opcionesPersonas = (options.people || []).map(p => ({ id: p.id, name: p.name, sectorId: p.sectorId || '', sectorName: p.sectorName || '' }));
  E.store.opcionesEquipos = (options.equipment || []).map(e => ({ id: e.id, model: e.model || '', type: e.type || '', sectorId: e.sectorId || '', sectorName: e.sectorName || '' }));
  catalogosCargados = true;
}

// Datos de la pantalla actual. Antes esta funcion traia TODO -personas,
// equipos, tickets, bitacora, catalogos- en cada cambio de vista, aunque la
// pantalla usara una sola de esas listas. Ahora pide los catalogos (una vez) y
// solo la pagina del listado que se esta mirando.
export async function loadStaffData(vista) {
  await loadCatalogos();

  const listaDeLaVista = { tickets:'tickets', employees:'employees', equipment:'equipment', logbook:'logbook', users:'users' }[vista];
  if (listaDeLaVista && !(listaDeLaVista === 'logbook' && !isAdmin())) {
    await cargarPagina(listaDeLaVista);
  }

  // El tablero necesita los numeros (que los calcula la base) y una pagina de
  // tickets recientes para el panel de "requieren atencion".
  if (vista === 'dashboard' || vista === undefined) {
    const [stats] = await Promise.all([api('/tickets/stats'), cargarPagina('tickets')]);
    E.store.stats = stats.estadisticas;
    if (isAdmin()) await cargarPagina('logbook');
    E.store.activity = deriveActivity(E.store.tickets, E.store.logbook);
  }
}

export async function loadUsers() {
  await cargarPagina('users');
}
export async function loadEmployeeData() {
  // El rango User no puede listar /employees ni /equipment completos, pero
  // SI necesita elegir persona/equipo/sector/turno al crear un ticket:
  // /tickets/form-options le da exactamente eso (solo activos, datos minimos).
  const [ticketsRes, options] = await Promise.all([api('/tickets'), api('/tickets/form-options')]);
  E.store.categories = options.categories || [];
  E.store.tickets = ticketsRes.tickets.map(normalizeTicket);
  E.store.employees = options.people.map(p => ({ id: p.id, code: '', name: p.name, document: '—', email: '', phone: '', extension: '', sectorId: p.sectorId || '', sectorName: p.sectorName || '', position: '', status: 'Activo', workShift: '', schedule: '', replacement: '', replacementInfo: null, notes: '', changeLog: '', sectorEquipment: [] }));
  E.store.equipment = options.equipment.map(e => ({ id: e.id, code: '', type: e.type || '', model: e.model || '', status: 'Activo', sectorId: e.sectorId || '', sectorName: e.sectorName || '', changeLog: '' }));
  E.store.opcionesPersonas = options.people.map(p => ({ id: p.id, name: p.name, sectorId: p.sectorId || '', sectorName: p.sectorName || '' }));
  E.store.opcionesEquipos = options.equipment.map(e => ({ id: e.id, model: e.model || '', type: e.type || '', sectorId: e.sectorId || '', sectorName: e.sectorName || '' }));
  E.store.sectors = options.sectors.map(normalizeSector);
  E.store.schedules = options.schedules.map(normalizeSchedule);
}
export function relativeTime(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  return `Hace ${Math.round(hrs / 24)} d`;
}
export function deriveActivity(tickets, logbook) {
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
