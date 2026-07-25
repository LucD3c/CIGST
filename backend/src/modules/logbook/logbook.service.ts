import { HttpError } from '../../utils/httpError';
import { prisma } from '../../db/prisma';
import * as repo from './logbook.repository';
import type { CreateLogbookEntryInput, UpdateLogbookEntryInput } from './logbook.schema';

async function assertTicketExists(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.ticket.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!found) throw HttpError.badRequest('El ticket relacionado indicado no existe.');
}

async function assertEquipmentExists(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.equipment.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!found) throw HttpError.badRequest('El equipo relacionado indicado no existe.');
}

export async function list() {
  return repo.findMany();
}

export async function getById(id: string) {
  const entry = await repo.findById(id);
  if (!entry) throw HttpError.notFound('Evento de bitacora no encontrado.');
  return entry;
}

export async function create(authorId: string, data: CreateLogbookEntryInput) {
  await assertTicketExists(data.relatedTicketId);
  await assertEquipmentExists(data.relatedEquipmentId);
  return repo.create({ ...data, authorId });
}

export async function update(id: string, data: UpdateLogbookEntryInput) {
  await getById(id);
  if (data.relatedTicketId !== undefined) await assertTicketExists(data.relatedTicketId);
  if (data.relatedEquipmentId !== undefined) await assertEquipmentExists(data.relatedEquipmentId);
  return repo.update(id, data);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
