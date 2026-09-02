import { prisma } from '../../db/prisma';
import { nextCode } from '../../utils/codeGenerator';

const activeFilter = { deletedAt: null } as const;

const include = {
  author: { select: { id: true, name: true } },
  relatedTicket: { select: { id: true, code: true, title: true } },
  relatedEquipment: { select: { id: true, code: true, type: true, model: true } },
} as const;

export function findMany() {
  return prisma.logbookEntry.findMany({ where: activeFilter, include, orderBy: { occurredAt: 'desc' } });
}

export function filtroBusqueda(q?: string) {
  return {
    ...activeFilter,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' as const } },
            { code: { contains: q, mode: 'insensitive' as const } },
            { category: { contains: q, mode: 'insensitive' as const } },
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
    prisma.logbookEntry.findMany({ where, include, orderBy, skip, take }),
    prisma.logbookEntry.count({ where }),
  ]);
  return { items, total };
}

export function findById(id: string) {
  return prisma.logbookEntry.findFirst({ where: { id, ...activeFilter }, include });
}

export async function create(data: Record<string, unknown>) {
  const code = await nextCode('BIT', async (c) => (await prisma.logbookEntry.count({ where: { code: c } })) > 0);
  return prisma.logbookEntry.create({ data: { ...data, code } as never, include });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.logbookEntry.update({ where: { id }, data: data as never, include });
}

export function softDelete(id: string) {
  return prisma.logbookEntry.update({ where: { id }, data: { deletedAt: new Date() } });
}
