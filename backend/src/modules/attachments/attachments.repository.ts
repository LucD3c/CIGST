import { prisma } from '../../db/prisma';

export const attachmentSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  createdAt: true,
} as const;

export function create(data: {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
}) {
  return prisma.attachment.create({ data, select: attachmentSelect });
}

export function findById(id: string) {
  return prisma.attachment.findUnique({ where: { id } });
}

// Adjuntos que el usuario subio y todavia no vinculo a nada: son los unicos
// que puede adjuntar a un ticket o mensaje nuevo (evita que alguien "robe"
// un adjunto ajeno mandando un id que no le pertenece).
export function findLooseOwnedByUser(ids: string[], userId: string) {
  return prisma.attachment.findMany({
    where: { id: { in: ids }, uploadedById: userId, ticketId: null, messageId: null },
    select: { id: true },
  });
}

export function attachToTicket(ids: string[], ticketId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { ticketId } });
}

export function attachToMessage(ids: string[], messageId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { messageId } });
}

export function findByTicket(ticketId: string) {
  return prisma.attachment.findMany({
    where: { ticketId },
    select: attachmentSelect,
    orderBy: { createdAt: 'asc' },
  });
}

export function findByMessageIds(messageIds: string[]) {
  if (!messageIds.length) return Promise.resolve([]);
  return prisma.attachment.findMany({
    where: { messageId: { in: messageIds } },
    select: { ...attachmentSelect, messageId: true },
    orderBy: { createdAt: 'asc' },
  });
}

// Sueltos y viejos: quedaron de formularios que se abrieron, subieron un
// archivo y se cerraron sin enviar.
export function findOrphansOlderThan(cutoff: Date) {
  return prisma.attachment.findMany({
    where: { ticketId: null, messageId: null, createdAt: { lt: cutoff } },
    select: { id: true, storedName: true },
  });
}

export function deleteMany(ids: string[]) {
  return prisma.attachment.deleteMany({ where: { id: { in: ids } } });
}
