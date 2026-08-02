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
// "Suelto" = subido pero todavia no vinculado a NADA. Los cuatro destinos
// tienen que estar en null: si faltara alguno, un adjunto ya publicado en el
// feed se podria re-vincular a un ticket ajeno y quedaria visible para quien
// no debe.
export function findLooseOwnedByUser(ids: string[], userId: string) {
  return prisma.attachment.findMany({
    where: {
      id: { in: ids },
      uploadedById: userId,
      ticketId: null,
      messageId: null,
      postId: null,
      articleId: null,
    },
    select: { id: true },
  });
}

// Al EDITAR una publicacion o un articulo, sus imagenes ya estan vinculadas a
// el: no son sueltas y no pasarian el chequeo de arriba. Aca se aceptan las
// que ya pertenecen a ese mismo destino, y nada mas.
export function findReusableForTarget(
  ids: string[],
  userId: string,
  target: { postId?: string; articleId?: string },
) {
  const yaMio = target.postId ? { postId: target.postId } : { articleId: target.articleId };
  return prisma.attachment.findMany({
    where: {
      id: { in: ids },
      OR: [
        { uploadedById: userId, ticketId: null, messageId: null, postId: null, articleId: null },
        yaMio,
      ],
    },
    select: { id: true },
  });
}

export function attachToTicket(ids: string[], ticketId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { ticketId } });
}

export function attachToMessage(ids: string[], messageId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { messageId } });
}

export function attachToPost(ids: string[], postId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { postId } });
}

export function attachToArticle(ids: string[], articleId: string) {
  return prisma.attachment.updateMany({ where: { id: { in: ids } }, data: { articleId } });
}

// Al guardar, los adjuntos que dejaron de estar referenciados por los bloques
// se desvinculan y vuelven a quedar sueltos; la rutina de huerfanos los borra
// 24 h despues. Asi sacar una imagen de un articulo tambien libera el disco.
export function detachFromPostExcept(postId: string, keepIds: string[]) {
  return prisma.attachment.updateMany({
    where: { postId, id: { notIn: keepIds.length ? keepIds : ['-'] } },
    data: { postId: null },
  });
}

export function detachFromArticleExcept(articleId: string, keepIds: string[]) {
  return prisma.attachment.updateMany({
    where: { articleId, id: { notIn: keepIds.length ? keepIds : ['-'] } },
    data: { articleId: null },
  });
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
// Huerfano = no esta vinculado a NINGUNO de los cuatro destinos. Sin incluir
// postId/articleId aca, las imagenes del feed y de las bases de conocimiento
// se borrarian solas a las 24 horas de subidas.
export function findOrphansOlderThan(cutoff: Date) {
  return prisma.attachment.findMany({
    where: {
      ticketId: null,
      messageId: null,
      postId: null,
      articleId: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true, storedName: true },
  });
}

export function deleteMany(ids: string[]) {
  return prisma.attachment.deleteMany({ where: { id: { in: ids } } });
}
