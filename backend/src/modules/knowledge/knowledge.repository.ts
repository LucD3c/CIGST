import { prisma } from '../../db/prisma';
import type { StoredBlock } from '../../utils/contentBlocks';

const activo = { deletedAt: null } as const;

export function findSpaces() {
  return prisma.kbSpace.findMany({
    where: activo,
    orderBy: { name: 'asc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { sections: true } },
    },
  });
}

export function findSpaceById(id: string) {
  return prisma.kbSpace.findFirst({
    where: { id, ...activo },
    include: { createdBy: { select: { id: true, name: true } } },
  });
}

export function createSpace(data: { name: string; description: string; icon: string; createdById: string }) {
  return prisma.kbSpace.create({ data });
}

export function updateSpace(id: string, data: Record<string, unknown>) {
  return prisma.kbSpace.update({ where: { id }, data });
}

export function softDeleteSpace(id: string) {
  return prisma.kbSpace.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Arbol de la base: secciones ordenadas, cada una con sus articulos. */
export function findTree(spaceId: string) {
  return prisma.kbSection.findMany({
    where: { spaceId },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    include: {
      articles: {
        where: activo,
        orderBy: [{ position: 'asc' }, { title: 'asc' }],
        select: { id: true, title: true, position: true, updatedAt: true },
      },
    },
  });
}

export function findSectionById(id: string) {
  return prisma.kbSection.findUnique({ where: { id } });
}

export async function createSection(spaceId: string, name: string) {
  const ultima = await prisma.kbSection.findFirst({
    where: { spaceId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return prisma.kbSection.create({ data: { spaceId, name, position: (ultima?.position ?? -1) + 1 } });
}

export function updateSection(id: string, data: { name?: string; position?: number }) {
  return prisma.kbSection.update({ where: { id }, data });
}

export function deleteSection(id: string) {
  return prisma.kbSection.delete({ where: { id } });
}

export function countArticlesInSection(sectionId: string) {
  return prisma.kbArticle.count({ where: { sectionId, ...activo } });
}

const articleInclude = {
  blocks: { orderBy: { position: 'asc' } },
  section: { select: { id: true, name: true, spaceId: true } },
  updatedBy: { select: { id: true, name: true } },
} as const;

export type ArticleConDetalle = NonNullable<Awaited<ReturnType<typeof findArticleById>>>;

export function findArticleById(id: string) {
  return prisma.kbArticle.findFirst({ where: { id, ...activo }, include: articleInclude });
}

export async function createArticle(data: {
  sectionId: string;
  title: string;
  updatedById: string;
  blocks: StoredBlock[];
}) {
  const ultima = await prisma.kbArticle.findFirst({
    where: { sectionId: data.sectionId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return prisma.kbArticle.create({
    data: {
      sectionId: data.sectionId,
      title: data.title,
      updatedById: data.updatedById,
      position: (ultima?.position ?? -1) + 1,
      blocks: { create: data.blocks.map((b) => ({ kind: b.kind, position: b.position, data: b.data as object })) },
    },
    include: articleInclude,
  });
}

// Igual que en el feed: al guardar se reemplazan todos los bloques dentro de
// una transaccion, en vez de intentar casar cual bloque es cual.
export function updateArticle(
  id: string,
  data: { title?: string; sectionId?: string; position?: number; updatedById: string; blocks?: StoredBlock[] },
) {
  return prisma.$transaction(async (tx) => {
    if (data.blocks) {
      await tx.kbBlock.deleteMany({ where: { articleId: id } });
      await tx.kbBlock.createMany({
        data: data.blocks.map((b) => ({ articleId: id, kind: b.kind, position: b.position, data: b.data as object })),
      });
    }
    await tx.kbArticle.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.sectionId !== undefined ? { sectionId: data.sectionId } : {}),
        ...(data.position !== undefined ? { position: data.position } : {}),
        updatedById: data.updatedById,
      },
    });
    return tx.kbArticle.findFirst({ where: { id }, include: articleInclude });
  });
}

export function softDeleteArticle(id: string) {
  return prisma.kbArticle.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ---------- Permisos ---------- */

export function findPermissions(spaceId: string) {
  return prisma.kbPermission.findMany({
    where: { spaceId },
    include: {
      sector: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
}

export function createPermission(data: {
  spaceId: string;
  level: string;
  sectorId?: string | null;
  role?: string | null;
  userId?: string | null;
}) {
  return prisma.kbPermission.create({ data });
}

export function findPermissionById(id: string) {
  return prisma.kbPermission.findUnique({ where: { id } });
}

export function deletePermission(id: string) {
  return prisma.kbPermission.delete({ where: { id } });
}

/**
 * Busca artículos por titulo dentro de las bases indicadas. El contenido de
 * los bloques se filtra despues en el service: guardar una copia en texto
 * duplicaria el dato y habria que mantenerla sincronizada.
 */
export function searchArticles(spaceIds: string[], q: string) {
  if (!spaceIds.length) return Promise.resolve([]);
  return prisma.kbArticle.findMany({
    where: {
      ...activo,
      section: { spaceId: { in: spaceIds } },
      title: { contains: q, mode: 'insensitive' },
    },
    take: 40,
    orderBy: { updatedAt: 'desc' },
    include: { section: { select: { id: true, name: true, spaceId: true, space: { select: { name: true } } } } },
  });
}
