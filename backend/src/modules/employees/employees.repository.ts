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
              { sector: { name: { contains: q, mode: 'insensitive' as const } } },
              { extension: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: { sector: true },
    orderBy: { name: 'asc' },
  });
}

// Filtro de busqueda compartido entre el listado paginado y su conteo.
export function filtroBusqueda(q?: string) {
  return {
    ...activeFilter,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { sector: { name: { contains: q, mode: 'insensitive' as const } } },
            { extension: { contains: q, mode: 'insensitive' as const } },
            { code: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

export async function findPage(
  where: Record<string, unknown>,
  skip: number,
  take: number,
  orderBy: Record<string, unknown>,
) {
  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, include: { sector: true }, orderBy, skip, take }),
    prisma.employee.count({ where }),
  ]);
  return { items, total };
}

export function findById(id: string) {
  return prisma.employee.findFirst({
    where: { id, ...activeFilter },
    include: {
      sector: true,
      replacement: true,
      ticketsAsAffected: { where: activeFilter, orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function create(data: CreateEmployeeInput) {
  const code = await nextCode('EMP', async (c) => (await prisma.employee.count({ where: { code: c } })) > 0);
  return prisma.employee.create({ data: { ...data, code } });
}

export function update(id: string, data: UpdateEmployeeInput & { changeLog?: string }) {
  return prisma.employee.update({ where: { id }, data, include: { sector: true, replacement: true } });
}

export function softDelete(id: string) {
  return prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}

export function existsActive(id: string) {
  return prisma.employee.findFirst({ where: { id, ...activeFilter }, select: { id: true } });
}

// Reutilizado por sectors.service para mostrar, en el detalle de un sector,
// que personas lo integran.
export function findBySector(sectorId: string) {
  return prisma.employee.findMany({
    where: { sectorId, ...activeFilter },
    orderBy: { name: 'asc' },
  });
}
