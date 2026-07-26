import { prisma } from '../../db/prisma';
import type { CreateSectorInput, UpdateSectorInput } from './sectors.schema';

const activeFilter = { deletedAt: null } as const;

export function findMany(q?: string) {
  return prisma.sector.findMany({
    where: {
      ...activeFilter,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { name: 'asc' },
  });
}

export function findById(id: string) {
  return prisma.sector.findFirst({ where: { id, ...activeFilter } });
}

export function create(data: CreateSectorInput) {
  return prisma.sector.create({ data });
}

export function update(id: string, data: UpdateSectorInput) {
  return prisma.sector.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.sector.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}

// Reutilizado por employees/equipment/tickets para validar un sectorId antes
// de guardarlo, igual que employeesRepo.existsActive.
export function existsActive(id: string) {
  return prisma.sector.findFirst({ where: { id, ...activeFilter, status: 'Activo' }, select: { id: true } });
}
