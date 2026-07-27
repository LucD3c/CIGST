import { HttpError } from '../../utils/httpError';
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

// La categoria tiene que ser una de las que definio ESE sector.
//
// "sectorWasChosen" distingue el sector elegido a mano del deducido de la
// persona a asistir: si el sector se dedujo, no se exige categoria (el
// formulario no tenia como ofrecerla), simplemente queda la de por defecto.
// Y si el sector todavia no tiene ninguna categoria cargada, tampoco se
// exige: nunca se bloquea a alguien que necesita pedir ayuda porque falta
// configurar el catalogo.
async function resolveCategory(
  sectorId: string | null | undefined,
  category: string | undefined,
  sectorWasChosen: boolean,
) {
  const requested = category?.trim();
  if (!sectorId) return requested || DEFAULT_CATEGORY;

  const available = await sectorsRepo.countCategories(sectorId);
  if (available === 0) return requested || DEFAULT_CATEGORY;

  if (!requested) {
    if (!sectorWasChosen) return DEFAULT_CATEGORY;
    throw HttpError.badRequest('Elegí una categoría para el sector seleccionado.');
  }
  const found = await sectorsRepo.findCategoryByName(sectorId, requested);
  if (!found) throw HttpError.badRequest('Esa categoría no corresponde al sector elegido.');
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

export async function list(user: SessionUser, q?: string) {
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
  return repo.findMany(where);
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

  const affected = await employeesRepo.findById(employeeId);
  const sectorWasChosen = Boolean(data.sectorId);
  const sectorId = data.sectorId ?? affected?.sectorId ?? null;
  const category = await resolveCategory(sectorId, data.category, sectorWasChosen);

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
      orderBy: { createdAt: 'desc' },
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
    people: people.map((p) => ({ id: p.id, name: p.name, sectorId: p.sectorId, sectorName: p.sector?.name ?? '' })),
    equipment: equipment.map((e) => ({ id: e.id, model: e.model, type: e.type, sectorId: e.sectorId, sectorName: e.sector?.name ?? '' })),
    sectors,
    schedules,
    // El formulario filtra estas categorias por el sector elegido, sin
    // volver a pedir nada al servidor al cambiar el desplegable.
    categories,
  };
}
