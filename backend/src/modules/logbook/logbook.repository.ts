import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';

const activeFilter = { deletedAt: null } as const;

const include = {
  author: { select: { id: true, name: true } },
  relatedTicket: { select: { id: true, code: true, title: true } },
  relatedEquipment: { select: { id: true, code: true, brand: true, model: true } },
} as const;

export function findMany() {
  return prisma.logbookEntry.findMany({ where: activeFilter, include, orderBy: { occurredAt: 'desc' } });
}

export function findById(id: string) {
  return prisma.logbookEntry.findFirst({ where: { id, ...activeFilter }, include });
}

export async function create(data: Record<string, unknown>) {
  const code = await nextCode('BIT', () => prisma.logbookEntry.count());
  return prisma.logbookEntry.create({ data: { ...data, code } as never, include });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.logbookEntry.update({ where: { id }, data: data as never, include });
}

export function softDelete(id: string) {
  return prisma.logbookEntry.update({ where: { id }, data: { deletedAt: new Date() } });
}
