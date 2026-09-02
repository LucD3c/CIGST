import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import { toStored, attachmentIdsOf, plainTextOf, type ContentBlock } from '../../utils/contentBlocks';
import * as repo from './knowledge.repository';
import * as permisos from './knowledge.permissions';
import * as attachments from '../attachments/attachments.service';
import type { SessionUser } from '../auth/auth.service';
import type {
  CreateSpaceInput,
  UpdateSpaceInput,
  CreateArticleInput,
  UpdateArticleInput,
  CreatePermissionInput,
} from './knowledge.schema';

/* ---------- Bases ---------- */

export async function listSpaces(user: SessionUser) {
  const accesos = await permisos.basesVisibles(user);
  const espacios = await repo.findSpaces();
  return espacios
    .filter((e) => accesos.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      icon: e.icon,
      status: e.status,
      sectionCount: e._count.sections,
      createdBy: e.createdBy,
      myLevel: accesos.get(e.id)!,
      updatedAt: e.updatedAt,
    }));
}

export async function getSpace(user: SessionUser, id: string) {
  const nivel = await permisos.assertPuedeLeer(user, id);
  const space = await repo.findSpaceById(id);
  if (!space) throw HttpError.notFound('Base de conocimiento no encontrada.');
  const secciones = await repo.findTree(id);
  return {
    id: space.id,
    name: space.name,
    description: space.description,
    icon: space.icon,
    status: space.status,
    createdBy: space.createdBy,
    myLevel: nivel,
    sections: secciones.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      articles: s.articles,
    })),
  };
}

export async function createSpace(user: SessionUser, data: CreateSpaceInput) {
  permisos.assertPuedeAdministrar(user);
  try {
    const space = await repo.createSpace({
      name: data.name,
      description: data.description ?? '',
      icon: data.icon || '📘',
      createdById: user.id,
    });
    return space;
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe una base de conocimiento con ese nombre.');
    throw err;
  }
}

export async function updateSpace(user: SessionUser, id: string, data: UpdateSpaceInput) {
  await permisos.assertPuedeEditar(user, id);
  try {
    return await repo.updateSpace(id, data);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe una base de conocimiento con ese nombre.');
    throw err;
  }
}

export async function removeSpace(user: SessionUser, id: string) {
  permisos.assertPuedeAdministrar(user);
  const space = await repo.findSpaceById(id);
  if (!space) throw HttpError.notFound('Base de conocimiento no encontrada.');
  await repo.softDeleteSpace(id);
}

/* ---------- Secciones ---------- */

async function spaceIdDeSeccion(sectionId: string) {
  const seccion = await repo.findSectionById(sectionId);
  if (!seccion) throw HttpError.notFound('Sección no encontrada.');
  return seccion.spaceId;
}

export async function createSection(user: SessionUser, spaceId: string, name: string) {
  await permisos.assertPuedeEditar(user, spaceId);
  return repo.createSection(spaceId, name);
}

export async function updateSection(user: SessionUser, sectionId: string, data: { name?: string; position?: number }) {
  const spaceId = await spaceIdDeSeccion(sectionId);
  await permisos.assertPuedeEditar(user, spaceId);
  return repo.updateSection(sectionId, data);
}

export async function removeSection(user: SessionUser, sectionId: string) {
  const spaceId = await spaceIdDeSeccion(sectionId);
  await permisos.assertPuedeEditar(user, spaceId);
  // No se borra una seccion con articulos adentro: quedarian sin lugar en el
  // arbol y desaparecerian de la vista sin que nadie los haya borrado.
  const cuantos = await repo.countArticlesInSection(sectionId);
  if (cuantos > 0) {
    throw HttpError.conflict(
      `No se puede eliminar esta sección: todavía tiene ${cuantos} ${cuantos === 1 ? 'artículo' : 'artículos'}. ` +
        'Movelos o eliminalos antes.',
    );
  }
  await repo.deleteSection(sectionId);
}

/* ---------- Articulos ---------- */

function serializarArticulo(a: repo.ArticleConDetalle) {
  return {
    id: a.id,
    title: a.title,
    sectionId: a.sectionId,
    sectionName: a.section.name,
    spaceId: a.section.spaceId,
    position: a.position,
    blocks: a.blocks.map((b) => ({ kind: b.kind, data: b.data })),
    updatedBy: a.updatedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function getArticle(user: SessionUser, id: string) {
  const articulo = await repo.findArticleById(id);
  if (!articulo) throw HttpError.notFound('Artículo no encontrado.');
  const nivel = await permisos.assertPuedeLeer(user, articulo.section.spaceId);
  return { ...serializarArticulo(articulo), myLevel: nivel };
}

export async function createArticle(user: SessionUser, data: CreateArticleInput) {
  const spaceId = await spaceIdDeSeccion(data.sectionId);
  await permisos.assertPuedeEditar(user, spaceId);

  const blocks = data.blocks as ContentBlock[];
  const articulo = await repo.createArticle({
    sectionId: data.sectionId,
    title: data.title,
    updatedById: user.id,
    blocks: toStored(blocks),
  });
  await attachments.linkToArticle(attachmentIdsOf(blocks), articulo.id, user.id);
  return serializarArticulo(articulo);
}

export async function updateArticle(user: SessionUser, id: string, data: UpdateArticleInput) {
  const existente = await repo.findArticleById(id);
  if (!existente) throw HttpError.notFound('Artículo no encontrado.');
  await permisos.assertPuedeEditar(user, existente.section.spaceId);

  // Mover un articulo a otra seccion solo vale dentro de la MISMA base: si no,
  // cambiaria de permisos sin que nadie lo decida.
  if (data.sectionId && data.sectionId !== existente.sectionId) {
    const destino = await spaceIdDeSeccion(data.sectionId);
    if (destino !== existente.section.spaceId) {
      throw HttpError.badRequest('No se puede mover un artículo a otra base de conocimiento.');
    }
  }

  const blocks = data.blocks as ContentBlock[] | undefined;
  const actualizado = await repo.updateArticle(id, {
    title: data.title,
    sectionId: data.sectionId,
    position: data.position,
    updatedById: user.id,
    blocks: blocks ? toStored(blocks) : undefined,
  });
  if (!actualizado) throw HttpError.notFound('Artículo no encontrado.');
  if (blocks) await attachments.linkToArticle(attachmentIdsOf(blocks), id, user.id);
  return serializarArticulo(actualizado);
}

export async function removeArticle(user: SessionUser, id: string) {
  const existente = await repo.findArticleById(id);
  if (!existente) throw HttpError.notFound('Artículo no encontrado.');
  await permisos.assertPuedeEditar(user, existente.section.spaceId);
  await repo.softDeleteArticle(id);
}

/* ---------- Permisos ---------- */

export async function listPermissions(user: SessionUser, spaceId: string) {
  permisos.assertPuedeAdministrar(user);
  const filas = await repo.findPermissions(spaceId);
  return filas.map((p) => ({
    id: p.id,
    level: p.level,
    sector: p.sector,
    role: p.role,
    user: p.user,
  }));
}

export async function addPermission(user: SessionUser, spaceId: string, data: CreatePermissionInput) {
  permisos.assertPuedeAdministrar(user);
  const space = await repo.findSpaceById(spaceId);
  if (!space) throw HttpError.notFound('Base de conocimiento no encontrada.');

  if (data.sectorId) {
    const existe = await prisma.sector.count({ where: { id: data.sectorId, deletedAt: null } });
    if (!existe) throw HttpError.badRequest('Ese sector no existe.');
  }
  if (data.userId) {
    const existe = await prisma.user.count({ where: { id: data.userId, deletedAt: null } });
    if (!existe) throw HttpError.badRequest('Esa persona no existe.');
  }

  return repo.createPermission({
    spaceId,
    level: data.level,
    sectorId: data.sectorId ?? null,
    role: data.role ?? null,
    userId: data.userId ?? null,
  });
}

export async function removePermission(user: SessionUser, spaceId: string, permissionId: string) {
  permisos.assertPuedeAdministrar(user);
  const permiso = await repo.findPermissionById(permissionId);
  if (!permiso || permiso.spaceId !== spaceId) throw HttpError.notFound('Permiso no encontrado.');
  await repo.deletePermission(permissionId);
}

/* ---------- Busqueda ---------- */

/**
 * Busca por titulo y tambien dentro del contenido, pero SOLO en las bases que
 * la persona puede leer. Los valores marcados como ocultos (usuarios y claves)
 * quedan fuera del texto de busqueda a proposito: no tendria sentido taparlos
 * en pantalla y devolverlos en un resultado.
 */
export async function search(user: SessionUser, q: string) {
  const accesos = await permisos.basesVisibles(user);
  const spaceIds = [...accesos.keys()];
  if (!spaceIds.length) return [];

  const porTitulo = await repo.searchArticles(spaceIds, q);
  const encontrados = new Map(porTitulo.map((a) => [a.id, a]));

  // Contenido: lo resuelve la base sobre la columna search_text, que tiene su
  // propio indice. Antes se traian hasta 500 articulos a memoria y se filtraban
  // ahi: pasados los 500, los que quedaban afuera no aparecian nunca en ninguna
  // busqueda y nadie se enteraba. Ahora no hay ningun tope silencioso.
  const porContenido = await prisma.kbArticle.findMany({
    where: {
      deletedAt: null,
      section: { spaceId: { in: spaceIds } },
      searchText: { contains: q.toLowerCase() },
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      section: { select: { id: true, name: true, spaceId: true, space: { select: { name: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });

  for (const a of porContenido) {
    if (!encontrados.has(a.id)) encontrados.set(a.id, a as never);
  }

  return [...encontrados.values()].slice(0, 40).map((a) => ({
    id: a.id,
    title: a.title,
    sectionName: a.section.name,
    spaceId: a.section.spaceId,
    spaceName: a.section.space.name,
    updatedAt: a.updatedAt,
  }));
}
