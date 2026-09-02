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
    orderBy: [{ model: 'asc' }, { type: 'asc' }],
  });
}

export function filtroBusqueda(q?: string) {
  return {
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
  };
}

export async function findPage(
  where: Record<string, unknown>,
  skip: number,
  take: number,
  orderBy: Record<string, unknown> | Record<string, unknown>[],
) {
  const [items, total] = await Promise.all([
    prisma.equipment.findMany({ where, include: { sector: true }, orderBy, skip, take }),
    prisma.equipment.count({ where }),
  ]);
  return { items, total };
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
    orderBy: [{ model: 'asc' }, { type: 'asc' }],
  });
}

export async function create(data: CreateEquipmentInput) {
  // Si vino un codigo escrito a mano se respeta tal cual; si no, lo genera la
  // plataforma salteando los numeros que ya esten ocupados por codigos manuales.
  const { code: codigoPropio, ...resto } = data;
  const code =
    codigoPropio && codigoPropio.trim()
      ? codigoPropio.trim()
      : await nextCode('EQ', async (c) => (await prisma.equipment.count({ where: { code: c } })) > 0);
  return prisma.equipment.create({ data: { ...resto, code, status: 'Activo' }, include: { sector: true } });
}

// Existe otro equipo (vivo o dado de baja) con ese codigo? Se consulta antes de
// guardar para poder dar un mensaje claro en vez de un error de base de datos.
export async function codigoOcupado(code: string, excepto?: string) {
  const encontrado = await prisma.equipment.findFirst({
    where: { code, ...(excepto ? { NOT: { id: excepto } } : {}) },
    select: { id: true, deletedAt: true, model: true, type: true },
  });
  return encontrado;
}

export function update(id: string, data: UpdateEquipmentInput & { changeLog?: string }) {
  return prisma.equipment.update({ where: { id }, data, include: { sector: true } });
}

export function softDelete(id: string) {
  return prisma.equipment.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } });
}
