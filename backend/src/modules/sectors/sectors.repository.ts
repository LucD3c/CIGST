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

/* ---------- Categorias de ticket por sector ---------- */

export function findCategories(sectorId: string) {
  return prisma.ticketCategory.findMany({ where: { sectorId }, orderBy: { name: 'asc' } });
}

// Todas las categorias de todos los sectores activos, en una sola consulta:
// la usa /tickets/form-options para que el formulario cambie la lista al
// elegir sector sin pedir nada mas al servidor.
export function findAllCategories() {
  return prisma.ticketCategory.findMany({
    where: { sector: { deletedAt: null, status: 'Activo' } },
    select: { id: true, name: true, sectorId: true },
    orderBy: { name: 'asc' },
  });
}

export function createCategory(sectorId: string, name: string) {
  return prisma.ticketCategory.create({ data: { sectorId, name } });
}

export function findCategoryById(id: string) {
  return prisma.ticketCategory.findUnique({ where: { id } });
}

export function deleteCategory(id: string) {
  return prisma.ticketCategory.delete({ where: { id } });
}

// Valida que un nombre de categoria pertenezca al sector indicado (lo usa
// tickets.service antes de guardar el ticket).
export function findCategoryByName(sectorId: string, name: string) {
  return prisma.ticketCategory.findUnique({ where: { sectorId_name: { sectorId, name } } });
}

export function countCategories(sectorId: string) {
  return prisma.ticketCategory.count({ where: { sectorId } });
}
