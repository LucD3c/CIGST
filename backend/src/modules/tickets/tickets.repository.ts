import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';

const activeFilter = { deletedAt: null } as const;

const include = {
  employee: true,
  requestedBy: true,
  replacement: true,
  equipment: true,
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

export function findById(id: string) {
  return prisma.ticket.findFirst({ where: { id, ...activeFilter }, include });
}

export async function create(data: Record<string, unknown>) {
  const code = await nextCode('TK', () => prisma.ticket.count());
  return prisma.ticket.create({ data: { ...data, code } as never, include });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.ticket.update({ where: { id }, data: data as never, include });
}

export function softDelete(id: string) {
  return prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
}
