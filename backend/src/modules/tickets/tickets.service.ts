import { HttpError } from '../../utils/httpError';
import * as repo from './tickets.repository';
import * as employeesRepo from '../employees/employees.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import { prisma } from '../../db/prisma';
import type { SessionUser } from '../auth/auth.service';
import { ROLES } from '../../middleware/rbac.middleware';
import type { CreateTicketByStaffInput, CreateTicketSelfServiceInput, UpdateTicketInput } from './tickets.schema';

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

async function assertTechnicianExists(id: string | null | undefined) {
  if (!id) return;
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null, status: 'Activo', role: { name: { in: [ROLES.ADMIN, ROLES.TECH] } } },
    select: { id: true },
  });
  if (!user) throw HttpError.badRequest('El técnico asignado indicado no es válido.');
}

function isStaff(user: SessionUser) {
  return user.role === ROLES.ADMIN || user.role === ROLES.TECH;
}

export async function list(user: SessionUser, q?: string) {
  const where: Record<string, unknown> = {};
  if (!isStaff(user)) {
    if (!user.employeeId) return [];
    where.employeeId = user.employeeId;
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
  if (!isStaff(user) && ticket.employeeId !== user.employeeId) {
    throw HttpError.forbidden('No podés ver un ticket que no es tuyo.');
  }
  return ticket;
}

export async function createByStaff(user: SessionUser, data: CreateTicketByStaffInput) {
  await assertEmployeeExists(data.employeeId, 'La persona a asistir');
  const requestedById = data.requestedById ?? data.employeeId;
  await assertOptionalEmployeeExists(requestedById, 'La persona que solicito');
  await assertEquipmentExists(data.equipmentId);
  await assertSectorValid(data.sectorId);

  const affected = await employeesRepo.findById(data.employeeId);

  return repo.create({
    title: data.title,
    description: data.description,
    employeeId: data.employeeId,
    requestedById,
    equipmentId: data.equipmentId ?? null,
    sectorId: data.sectorId ?? affected?.sectorId ?? null,
    contact: data.contact ?? null,
    availability: data.availability ?? affected?.schedule ?? null,
    supportShift: data.supportShift ?? affected?.workShift ?? null,
    category: data.category,
    priority: data.priority ?? 'Media',
    status: 'Nuevo',
    createdById: user.id,
  });
}

export async function createSelfService(user: SessionUser, data: CreateTicketSelfServiceInput) {
  if (!user.employeeId) {
    throw HttpError.badRequest('Tu usuario no está vinculado a una persona; pedile a Sistemas que lo asocie.');
  }
  await assertEquipmentExists(data.equipmentId);
  await assertSectorValid(data.sectorId);

  const affected = await employeesRepo.findById(user.employeeId);

  return repo.create({
    title: data.title,
    description: data.description,
    employeeId: user.employeeId,
    requestedById: user.employeeId,
    equipmentId: data.equipmentId ?? null,
    sectorId: data.sectorId ?? affected?.sectorId ?? null,
    contact: data.contact ?? null,
    availability: data.availability ?? affected?.schedule ?? null,
    supportShift: data.supportShift ?? affected?.workShift ?? null,
    category: data.category,
    priority: data.priority ?? 'Media',
    status: 'Nuevo',
    createdById: user.id,
  });
}

export async function update(id: string, data: UpdateTicketInput) {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound('Ticket no encontrado.');
  if (data.technicianId !== undefined) await assertTechnicianExists(data.technicianId);
  return repo.update(id, data);
}

export async function remove(id: string) {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound('Ticket no encontrado.');
  return repo.softDelete(id);
}
