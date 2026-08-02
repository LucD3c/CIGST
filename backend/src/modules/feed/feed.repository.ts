import { prisma } from '../../db/prisma';
import type { StoredBlock } from '../../utils/contentBlocks';

const activo = { deletedAt: null } as const;

const autorSelect = { id: true, name: true, role: { select: { name: true } } } as const;

const postInclude = {
  author: { select: autorSelect },
  blocks: { orderBy: { position: 'asc' } },
  sectors: { include: { sector: { select: { id: true, name: true } } } },
  _count: { select: { comments: true, reactions: true, views: true } },
} as const;

export type PostConDetalle = NonNullable<Awaited<ReturnType<typeof findById>>>;

export function findById(id: string) {
  return prisma.post.findFirst({ where: { id, ...activo }, include: postInclude });
}

/**
 * Publicaciones que puede ver esta persona: las dirigidas a todos y las
 * dirigidas a alguno de sus sectores. Las fijadas van primero.
 *
 * `sectorIds` es plural porque una persona podria pertenecer a mas de un
 * sector en el futuro; hoy es uno solo o ninguno.
 */
export async function findVisible(
  sectorIds: string[],
  opciones: { before?: string; limit: number; q?: string },
) {
  const where: Record<string, unknown> = {
    ...activo,
    OR: [{ audience: 'todos' }, ...(sectorIds.length ? [{ sectors: { some: { sectorId: { in: sectorIds } } } }] : [])],
  };
  if (opciones.q) {
    where.AND = [{ title: { contains: opciones.q, mode: 'insensitive' } }];
  }

  // Orden compuesto: primero las fijadas, despues por fecha y por id. El id
  // desempata cuando dos publicaciones caen en el mismo milisegundo, que es
  // lo que hace confiable la paginacion por cursor.
  return prisma.post.findMany({
    where,
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: opciones.limit,
    ...(opciones.before ? { cursor: { id: opciones.before }, skip: 1 } : {}),
    include: postInclude,
  });
}

export function create(data: {
  authorId: string;
  title: string;
  audience: string;
  pinned: boolean;
  sectorIds: string[];
  blocks: StoredBlock[];
}) {
  return prisma.post.create({
    data: {
      authorId: data.authorId,
      title: data.title,
      audience: data.audience,
      pinned: data.pinned,
      blocks: { create: data.blocks.map((b) => ({ kind: b.kind, position: b.position, data: b.data as object })) },
      sectors: { create: data.sectorIds.map((sectorId) => ({ sectorId })) },
    },
    include: postInclude,
  });
}

/**
 * Al editar, los bloques y los destinatarios se reemplazan enteros dentro de
 * una transaccion: es mas simple y mas seguro que intentar casar cual bloque
 * es cual entre la version vieja y la nueva.
 */
export function update(
  id: string,
  data: {
    title?: string;
    pinned?: boolean;
    audience?: string;
    sectorIds?: string[];
    blocks?: StoredBlock[];
  },
) {
  return prisma.$transaction(async (tx) => {
    if (data.blocks) {
      await tx.postBlock.deleteMany({ where: { postId: id } });
      await tx.postBlock.createMany({
        data: data.blocks.map((b) => ({ postId: id, kind: b.kind, position: b.position, data: b.data as object })),
      });
    }
    if (data.audience !== undefined) {
      await tx.postSector.deleteMany({ where: { postId: id } });
      if (data.audience === 'sectores' && data.sectorIds?.length) {
        await tx.postSector.createMany({ data: data.sectorIds.map((sectorId) => ({ postId: id, sectorId })) });
      }
    }
    await tx.post.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
        ...(data.audience !== undefined ? { audience: data.audience } : {}),
      },
    });
    return tx.post.findFirst({ where: { id }, include: postInclude });
  });
}

export function softDelete(id: string) {
  return prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
}

export function sectorIdsOf(postId: string) {
  return prisma.postSector.findMany({ where: { postId }, select: { sectorId: true } });
}

/* ---------- Comentarios ---------- */

export function findComments(postId: string) {
  return prisma.postComment.findMany({
    where: { postId, ...activo },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: autorSelect } },
  });
}

export function createComment(postId: string, authorId: string, body: string) {
  return prisma.postComment.create({
    data: { postId, authorId, body },
    include: { author: { select: autorSelect } },
  });
}

export function findCommentById(id: string) {
  return prisma.postComment.findFirst({ where: { id, ...activo } });
}

export function softDeleteComment(id: string) {
  return prisma.postComment.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ---------- Reacciones y vistas ---------- */

export async function toggleReaction(postId: string, userId: string) {
  const existente = await prisma.postReaction.findUnique({ where: { postId_userId: { postId, userId } } });
  if (existente) {
    await prisma.postReaction.delete({ where: { id: existente.id } });
    return false;
  }
  await prisma.postReaction.create({ data: { postId, userId } });
  return true;
}

export function findMyReactions(postIds: string[], userId: string) {
  if (!postIds.length) return Promise.resolve([]);
  return prisma.postReaction.findMany({ where: { postId: { in: postIds }, userId }, select: { postId: true } });
}

export function findMyViews(postIds: string[], userId: string) {
  if (!postIds.length) return Promise.resolve([]);
  return prisma.postView.findMany({ where: { postId: { in: postIds }, userId }, select: { postId: true } });
}

/**
 * Marca una publicacion como vista. Una fila por persona: entrar diez veces
 * no infla el contador. `createMany` con skipDuplicates evita una consulta
 * previa y no falla si dos pestanas lo hacen a la vez.
 */
export async function markViewed(postId: string, userId: string) {
  const { count } = await prisma.postView.createMany({ data: [{ postId, userId }], skipDuplicates: true });
  if (count > 0) await prisma.post.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } });
  return count > 0;
}

export function findViewers(postId: string) {
  return prisma.postView.findMany({
    where: { postId },
    orderBy: { viewedAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  });
}

/** Publicaciones visibles que la persona todavia no abrio (para el badge). */
export function countUnseen(userId: string, sectorIds: string[]) {
  return prisma.post.count({
    where: {
      ...activo,
      OR: [{ audience: 'todos' }, ...(sectorIds.length ? [{ sectors: { some: { sectorId: { in: sectorIds } } } }] : [])],
      views: { none: { userId } },
    },
  });
}
