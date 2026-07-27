import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schema';

const activeFilter = { deletedAt: null } as const;

export function findMany(q?: string) {
  return prisma.equipment.findMany({
    where: {
      ...activeFilter,
      ...(q
        ? {
            OR: [
              { model: { contains: q, mode: 'insensitive' as const } },
              { type: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
              { sector: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    include: { sector: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function findById(id: string) {
  return prisma.equipment.findFirst({
    where: { id, ...activeFilter },
    include: {
      sector: true,
      tickets: { where: activeFilter, orderBy: { createdAt: 'desc' } },
    },
  });
}

// Reutilizado por employees.service para mostrar, en la ficha de una
// persona, el equipamiento de su mismo sector (ya no hay vinculo directo
// persona-equipo).
export function findBySector(sectorId: string) {
  return prisma.equipment.findMany({
    where: { sectorId, ...activeFilter },
    orderBy: { createdAt: 'desc' },
  });
}

export async function create(data: CreateEquipmentInput) {
  const code = await nextCode('EQ', () => prisma.equipment.count());
  return prisma.equipment.create({ data: { ...data, code, status: 'Activo' }, include: { sector: true } });
}

export function update(id: string, data: UpdateEquipmentInput & { changeLog?: string }) {
  return prisma.equipment.update({ where: { id }, data, include: { sector: true } });
}

export function softDelete(id: string) {
  return prisma.equipment.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}
