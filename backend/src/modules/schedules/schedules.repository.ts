import { prisma } from '../../db/prisma';
import type { CreateScheduleInput, UpdateScheduleInput } from './schedules.schema';

const activeFilter = { deletedAt: null } as const;

export function findMany() {
  return prisma.schedule.findMany({ where: activeFilter, orderBy: { startTime: 'asc' } });
}

export function findById(id: string) {
  return prisma.schedule.findFirst({ where: { id, ...activeFilter } });
}

export function create(data: CreateScheduleInput) {
  return prisma.schedule.create({ data });
}

export function update(id: string, data: UpdateScheduleInput) {
  return prisma.schedule.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.schedule.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}

export function existsActive(id: string) {
  return prisma.schedule.findFirst({ where: { id, ...activeFilter, status: 'Activo' }, select: { id: true } });
}
