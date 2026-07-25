import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';
import type { CreateEmployeeInput, UpdateEmployeeInput } from './employees.schema';

const activeFilter = { deletedAt: null } as const;

export function findMany(q?: string) {
  return prisma.employee.findMany({
    where: {
      ...activeFilter,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { sector: { contains: q, mode: 'insensitive' as const } },
              { extension: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: { equipment: { where: activeFilter } },
    orderBy: { name: 'asc' },
  });
}

export function findById(id: string) {
  return prisma.employee.findFirst({
    where: { id, ...activeFilter },
    include: {
      equipment: { where: activeFilter },
      replacement: true,
      ticketsAsAffected: { where: activeFilter, orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function create(data: CreateEmployeeInput) {
  const code = await nextCode('EMP', () => prisma.employee.count());
  return prisma.employee.create({ data: { ...data, code } });
}

export function update(id: string, data: UpdateEmployeeInput) {
  return prisma.employee.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}

export function existsActive(id: string) {
  return prisma.employee.findFirst({ where: { id, ...activeFilter }, select: { id: true } });
}
