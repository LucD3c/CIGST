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
              { asset: { contains: q, mode: 'insensitive' as const } },
              { serial: { contains: q, mode: 'insensitive' as const } },
              { brand: { contains: q, mode: 'insensitive' as const } },
              { model: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: { employee: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function findById(id: string) {
  return prisma.equipment.findFirst({
    where: { id, ...activeFilter },
    include: {
      employee: true,
      tickets: { where: activeFilter, orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function create(data: CreateEquipmentInput) {
  const code = await nextCode('EQ', () => prisma.equipment.count());
  return prisma.equipment.create({ data: { ...data, code, status: 'Operativo' } });
}

export function update(id: string, data: UpdateEquipmentInput) {
  return prisma.equipment.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.equipment.update({ where: { id }, data: { deletedAt: new Date(), status: 'Baja' } });
}
