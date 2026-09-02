import { HttpError } from '../../utils/httpError';
import { sortByName } from '../../utils/sortByName';
import { armarPagina, ordenar, saltear, type PaginationQuery } from '../../utils/pagination';
import * as repo from './tickets.repository';
import * as employeesRepo from '../employees/employees.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import * as schedulesRepo from '../schedules/schedules.repository';
import * as usersRepo from '../users/users.repository';
import * as notifications from '../notifications/notifications.service';
import { prisma } from '../../db/prisma';
import type { SessionUser } from '../auth/auth.service';
import { ROLES } from '../../middleware/rbac.middleware';
import * as attachments from '../attachments/attachments.service';
import * as realtime from '../../realtime/realtime.emit';
import { DEFAULT_CATEGORY } from './tickets.schema';
import type { CreateTicketInput, UpdateTicketInput } from './tickets.schema';

async function assertEmployeeExists(id: string, label: string) {
  const found = await employeesRepo.existsActive(id);
  if (!found) throw HttpError.badRequest(`${label} no existe.`);
}

async function assertOptionalEmployeeExists(id: string | null | undefined, label: string) {
  if (!id) return;
  await assertEmployeeExists(id, label);
}

async function assertEquipmentExists(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.equipment.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!found) throw HttpError.badRequest('El equipo relacionado indicado no existe.');
}

async function assertSectorValid(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const found = await sectorsRepo.existsActive(sectorId);
  if (!found) throw HttpError.badRequest('El sector indicado no existe.');
}

async function assertScheduleValid(scheduleId: string | null | undefined) {
  if (!scheduleId) return;
  const found = await schedulesRepo.existsActive(scheduleId);
  if (!found) throw HttpError.badRequest('El turno indicado no existe.');
}

// El sector del ticket es el SECTOR A REQUERIR: a que area se le pide ayuda
// (Sistemas, Mantenimiento...), no donde esta la persona ni donde esta el
// equipo. Por eso la categoria se valida contra ese sector: son las que ese
// area definio para los pedidos que recibe.
//
// Si el sector a requerir todavia no tiene categorias cargadas, se acepta la
// de por defecto: nunca se bloquea a alguien que necesita pedir ayuda porque
// falta configurar el catalogo.
async function resolveCategory(sectorId: string | null | undefined, category: string | undefined) {
  const requested = category?.trim();
  if (!sectorId) return requested || DEFAULT_CATEGORY;

  const available = await sectorsRepo.countCategories(sectorId);
  if (available === 0) return requested || DEFAULT_CATEGORY;

  if (!requested) throw HttpError.badRequest('Elegí una categoría para el sector a requerir.');
  const found = await sectorsRepo.findCategoryByName(sectorId, requested);
  if (!found) throw HttpError.badRequest('Esa categoría no corresponde al sector a requerir.');
  return found.name;
}

async function assertTechnicianExists(id: string | null | undefined) {
  if (!id) return;
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null, status: 'Activo', role: { name: { in: [ROLES.ADMIN, ROLES.SUPERVISOR] } } },
    select: { id: true },
  });
  if (!user) throw HttpError.badRequest('El responsable asignado indicado no es válido.');
}

function isStaff(user: SessionUser) {
  return user.role === ROLES.ADMIN || user.role === ROLES.SUPERVISOR;
}

// Usuario de la plataforma vinculado a una persona (para notificarle cambios
// en los tickets donde esa persona es la afectada).
function findUserByEmployeeId(employeeId: string | null) {
  if (!employeeId) return Promise.resolve(null);
  return prisma.user.findFirst({
    where: { employeeId, deletedAt: null, status: 'Activo' },
    select: { id: true },
  });
}

// Arma el filtro de visibilidad + busqueda. Se comparte entre el listado
// paginado y los conteos del tablero para que los dos vean exactamente lo
// mismo: si el tablero contara sobre un universo distinto al de la lista, los
// numeros no cerrarian con lo que la persona ve.
// Estados que se consideran "cerrados" para el filtro rapido del listado.
const ESTADOS_CERRADOS = ['Cerrado', 'Cancelado'];

function filtroPara(
  user: SessionUser,
  q?: string,
  estado?: string,
  extra?: { employeeId?: string; equipmentId?: string },
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (!isStaff(user)) {
    // Rango User: ve los tickets que creo el mismo y aquellos donde es la
    // persona a asistir. Nada mas.
    const own: Record<string, unknown>[] = [{ createdById: user.id }];
    if (user.employeeId) own.push({ employeeId: user.employeeId });
    where.AND = [{ OR: own }];
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
      { status: { contains: q, mode: 'insensitive' } },
    ];
  }
  // 'activos' esconde cerrados y cancelados (es lo que importa en el dia a
  // dia); 'todos' no filtra; cualquier otro valor es un estado concreto.
  if (estado && estado !== 'todos') {
    where.status = estado === 'activos' ? { notIn: ESTADOS_CERRADOS } : estado;
  }
  // Los filtros de ficha se suman a la visibilidad por rol, nunca la
  // reemplazan: un usuario de rango User que pida los tickets de otra persona
  // sigue viendo unicamente los suyos.
  if (extra?.employeeId) where.employeeId = extra.employeeId;
  if (extra?.equipmentId) where.equipmentId = extra.equipmentId;
  return where;
}

export async function list(user: SessionUser, q?: string) {
  return repo.findMany(filtroPara(user, q));
}

// Columnas por las que se puede ordenar desde la interfaz. El mapa es explicito
// a proposito: lo que no esta aca no se puede pedir, asi el cliente no puede
// ordenar por una columna arbitraria.
const ORDEN: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>> = {
  code: (d) => ({ code: d }),
  title: (d) => ({ title: d }),
  status: (d) => ({ status: d }),
  priority: (d) => ({ priority: d }),
  createdAt: (d) => ({ createdAt: d }),
  updatedAt: (d) => ({ updatedAt: d }),
  employee: (d) => ({ employee: { name: d } }),
  sectorName: (d) => ({ sector: { name: d } }),
  technician: (d) => ({ technician: { name: d } }),
};

export async function listarPagina(user: SessionUser, query: PaginationQuery) {
  const where = filtroPara(user, query.q, query.estado, {
    employeeId: query.employeeId,
    equipmentId: query.equipmentId,
  });
  const orderBy = ordenar(ORDEN, query.sort, query.dir, { createdAt: 'desc' });
  const { items, total } = await repo.findPage(where, saltear(query.page, query.pageSize), query.pageSize, orderBy);
  return armarPagina(items, total, query.page, query.pageSize);
}

// Numeros del tablero, calculados por la base y no por el navegador.
export async function estadisticas(user: SessionUser) {
  const where = filtroPara(user);
  const [porEstado, porPrioridad] = await Promise.all([repo.contarPorEstado(where), repo.contarPorPrioridad(where)]);

  const estados: Record<string, number> = {};
  for (const fila of porEstado) estados[fila.status] = fila._count._all;

  const prioridades: Record<string, number> = {};
  for (const fila of porPrioridad) prioridades[fila.priority] = fila._count._all;

  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  const cerrados = ['Resuelto', 'Cerrado', 'Cancelado'];
  const abiertos = Object.entries(estados)
    .filter(([nombre]) => !cerrados.includes(nombre))
    .reduce((a, [, n]) => a + n, 0);

  return {
    total,
    abiertos,
    criticos: prioridades['Crítica'] ?? 0,
    enProceso: estados['En proceso'] ?? 0,
    esperando: Object.entries(estados)
      .filter(([nombre]) => nombre.startsWith('Esperando'))
      .reduce((a, [, n]) => a + n, 0),
    resueltos: (estados['Resuelto'] ?? 0) + (estados['Cerrado'] ?? 0),
    estados,
    prioridades,
  };
}

export async function getById(user: SessionUser, id: string) {
  const ticket = await repo.findById(id);
  if (!ticket) throw HttpError.notFound('Ticket no encontrado.');
  const isOwn = ticket.employeeId === user.employeeId || ticket.createdById === user.id;
  if (!isStaff(user) && !isOwn) {
    throw HttpError.forbidden('No podés ver un ticket que no es tuyo.');
  }
  return { ...ticket, attachments: await attachments.listByTicket(id) };
}

// Alta unificada: cualquier rol crea tickets para cualquier persona y sector
// (regla de rangos). Si no eligio persona, se usa la vinculada a su usuario.
export async function create(user: SessionUser, data: CreateTicketInput) {
  const employeeId = data.employeeId ?? user.employeeId;
  if (!employeeId) {
    throw HttpError.badRequest('Elegí a la persona a asistir.');
  }
  await assertEmployeeExists(employeeId, 'La persona a asistir');
  const requestedById = data.requestedById ?? user.employeeId ?? employeeId;
  await assertOptionalEmployeeExists(requestedById, 'La persona que solicito');
  await assertEquipmentExists(data.equipmentId);
  await assertSectorValid(data.sectorId);
  await assertScheduleValid(data.scheduleId);

  // El sector es el que eligio quien crea el ticket (a que area le pide
  // ayuda). NO se hereda del sector de la persona ni del equipo: son cosas
  // distintas — una persona de Administracion puede pedirle a Mantenimiento.
  const sectorId = data.sectorId ?? null;
  const category = await resolveCategory(sectorId, data.category);

  const ticket = await repo.create({
    title: data.title,
    description: data.description,
    employeeId,
    requestedById,
    equipmentId: data.equipmentId ?? null,
    sectorId,
    scheduleId: data.scheduleId ?? null,
    category,
    priority: data.priority ?? 'Media',
    status: 'Nuevo',
    createdById: user.id,
  });

  await attachments.linkToTicket(data.attachmentIds, ticket.id, user.id);

  // Aviso al equipo de soporte (Admin + Supervisores activos), salvo a quien
  // lo acaba de crear.
  const staff = await usersRepo.findTechnicians();
  await notifications.notify(
    staff.map((s) => s.id),
    `Nuevo ticket ${ticket.code}: ${ticket.title}`,
    'ticket',
    ticket.id,
    user.id,
  );

  // Tiempo real: solo a quienes pueden ver ESTE ticket. La audiencia se
  // calcula en realtime.audience replicando el alcance de list()/getById().
  realtime.ticketChanged('ticket:created', ticket.id, ticket);

  return ticket;
}

export async function update(actingUser: SessionUser, id: string, data: UpdateTicketInput) {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound('Ticket no encontrado.');
  if (data.technicianId !== undefined) await assertTechnicianExists(data.technicianId);

  const updated = await repo.update(id, data);

  // Cambio de estado: avisar a quien creo el ticket y al usuario de la
  // persona afectada (si existen y no son quien hizo el cambio).
  if (data.status !== undefined && data.status !== existing.status) {
    const affectedUser = await findUserByEmployeeId(existing.employeeId);
    await notifications.notify(
      [existing.createdById, affectedUser?.id],
      `${updated.code} pasó a "${updated.status}"`,
      'ticket',
      updated.id,
      actingUser.id,
    );
  }

  // Asignacion: avisar al nuevo responsable.
  if (data.technicianId !== undefined && data.technicianId && data.technicianId !== existing.technicianId) {
    await notifications.notify(
      [data.technicianId],
      `Te asignaron el ticket ${updated.code}: ${updated.title}`,
      'ticket',
      updated.id,
      actingUser.id,
    );
  }

  realtime.ticketChanged('ticket:updated', updated.id, updated);

  return updated;
}

export async function remove(id: string) {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound('Ticket no encontrado.');
  return repo.softDelete(id);
}

// Opciones para el formulario de ticket, accesibles a cualquier rol
// autenticado: el rango User no puede listar /employees ni /equipment
// completos, pero SI necesita elegir persona/equipo/sector/turno al crear
// un ticket. Datos minimos, solo activos.
export async function formOptions() {
  const [people, equipment, sectors, schedules, categories] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null, status: 'Activo' },
      select: { id: true, name: true, sectorId: true, sector: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.equipment.findMany({
      where: { deletedAt: null, status: 'Activo' },
      select: { id: true, model: true, type: true, sectorId: true, sector: { select: { name: true } } },
      // Alfabetico: los desplegables se leen mucho mas rapido asi que por
      // fecha de alta.
      orderBy: [{ model: 'asc' }, { type: 'asc' }],
    }),
    prisma.sector.findMany({
      where: { deletedAt: null, status: 'Activo' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.schedule.findMany({
      where: { deletedAt: null, status: 'Activo' },
      select: { id: true, name: true, startTime: true, endTime: true },
      orderBy: { startTime: 'asc' },
    }),
    sectorsRepo.findAllCategories(),
  ]);
  return {
    people: sortByName(
      people.map((p) => ({ id: p.id, name: p.name, sectorId: p.sectorId, sectorName: p.sector?.name ?? '' })),
      (p) => p.name,
    ),
    equipment: sortByName(
      equipment.map((e) => ({ id: e.id, model: e.model, type: e.type, sectorId: e.sectorId, sectorName: e.sector?.name ?? '' })),
      (e) => e.model || e.type,
    ),
    sectors: sortByName(sectors, (s) => s.name),
    schedules,
    // El formulario filtra estas categorias por el sector elegido, sin
    // volver a pedir nada al servidor al cambiar el desplegable.
    categories,
  };
}
