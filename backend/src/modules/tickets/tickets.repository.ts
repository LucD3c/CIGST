import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';

const activeFilter = { deletedAt: null } as const;

const include = {
  employee: true,
  requestedBy: true,
  equipment: true,
  sector: true,
  schedule: true,
  technician: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

export function findMany(where: Record<string, unknown> = {}) {
  return prisma.ticket.findMany({
    where: { ...activeFilter, ...where },
    include,
    orderBy: { createdAt: 'desc' },
  });
}

// Campos que necesita el LISTADO, que no son los mismos que los de la ficha.
//
// El `include` completo de arriba arrastra cada columna de cada relacion,
// incluidas las de texto largo (las observaciones de una persona, el historial
// de cambios de un equipo). Multiplicado por 50 filas y por decenas de personas
// mirando la lista a la vez, eso era lo que hacia de /tickets el endpoint mas
// lento de todos. La ficha de un ticket sigue trayendo todo: ahi si hace falta.
const selectLista = {
  id: true,
  code: true,
  title: true,
  description: true,
  employeeId: true,
  requestedById: true,
  equipmentId: true,
  sectorId: true,
  scheduleId: true,
  category: true,
  technicianId: true,
  status: true,
  priority: true,
  solution: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  schedule: { select: { id: true, name: true, startTime: true, endTime: true } },
  technician: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

// Version paginada: es la que usa el listado de la interfaz. La consulta y el
// conteo van en paralelo porque son independientes entre si.
export async function findPage(
  where: Record<string, unknown>,
  skip: number,
  take: number,
  orderBy: Record<string, unknown> | Record<string, unknown>[],
) {
  const filtro = { ...activeFilter, ...where };
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({ where: filtro, select: selectLista, orderBy, skip, take }),
    prisma.ticket.count({ where: filtro }),
  ]);
  return { items, total };
}

// Conteos para el tablero. Antes el navegador se traia TODOS los tickets y los
// contaba en memoria; ahora los cuenta Postgres con un GROUP BY indexado y
// manda solo los numeros.
export async function contarPorEstado(where: Record<string, unknown>) {
  return prisma.ticket.groupBy({
    by: ['status'],
    where: { ...activeFilter, ...where },
    _count: { _all: true },
  });
}

export async function contarPorPrioridad(where: Record<string, unknown>) {
  return prisma.ticket.groupBy({
    by: ['priority'],
    where: { ...activeFilter, ...where },
    _count: { _all: true },
  });
}

export function findById(id: string) {
  return prisma.ticket.findFirst({ where: { id, ...activeFilter }, include });
}

export async function create(data: Record<string, unknown>) {
  const code = await nextCode('TK', async (c) => (await prisma.ticket.count({ where: { code: c } })) > 0);
  return prisma.ticket.create({ data: { ...data, code } as never, include });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.ticket.update({ where: { id }, data: data as never, include });
}

export function softDelete(id: string) {
  return prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
}
