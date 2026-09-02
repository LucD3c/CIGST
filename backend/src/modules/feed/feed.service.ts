import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';
import { ROLES } from '../../middleware/rbac.middleware';
import { toStored, attachmentIdsOf, summaryOf, type ContentBlock } from '../../utils/contentBlocks';
import * as repo from './feed.repository';
import * as attachments from '../attachments/attachments.service';
import * as notifications from '../notifications/notifications.service';
import type { SessionUser } from '../auth/auth.service';
import type { CreatePostInput, UpdatePostInput } from './feed.schema';

const DEFAULT_PAGE_SIZE = 15;

function esStaff(user: SessionUser) {
  return user.role === ROLES.ADMIN || user.role === ROLES.SUPERVISOR;
}

/**
 * Sectores de los que forma parte esta persona. Es lo que decide que
 * publicaciones ve: se resuelve SIEMPRE en el servidor a partir de su usuario,
 * nunca se acepta del cliente.
 */
async function sectoresDe(user: SessionUser): Promise<string[]> {
  if (!user.employeeId) return [];
  const empleado = await prisma.employee.findFirst({
    where: { id: user.employeeId, deletedAt: null },
    select: { sectorId: true },
  });
  return empleado?.sectorId ? [empleado.sectorId] : [];
}

/**
 * Puede ver esta publicacion: si es para todos, o si esta dirigida a alguno de
 * sus sectores. Quien publica (y el Administrador) siempre puede verla, para
 * no perder de vista lo que uno mismo escribio.
 */
export async function puedeVer(user: SessionUser, post: { id: string; audience: string; authorId: string | null }) {
  if (post.audience === 'todos') return true;
  if (post.authorId === user.id) return true;
  if (user.role === ROLES.ADMIN) return true;
  const [mios, del] = await Promise.all([sectoresDe(user), repo.sectorIdsOf(post.id)]);
  const dirigidos = new Set(del.map((s) => s.sectorId));
  return mios.some((s) => dirigidos.has(s));
}

async function traerVisible(user: SessionUser, id: string) {
  const post = await repo.findById(id);
  if (!post) throw HttpError.notFound('Publicación no encontrada.');
  if (!(await puedeVer(user, post))) throw HttpError.forbidden('No podés ver esta publicación.');
  return post;
}

// Publicar y editar es de Administrador y Supervisor. Editar o borrar una
// publicacion ajena, solo del Administrador: un Supervisor administra las
// suyas, no las de otro.
function assertPuedePublicar(user: SessionUser) {
  if (!esStaff(user)) throw HttpError.forbidden('No tenés permiso para publicar en el feed.');
}
function assertPuedeAdministrar(user: SessionUser, post: { authorId: string | null }) {
  if (user.role === ROLES.ADMIN) return;
  if (post.authorId === user.id) return;
  throw HttpError.forbidden('Solo podés editar tus propias publicaciones.');
}

function serializar(post: repo.PostConDetalle, extras: { mireaccion?: boolean; visto?: boolean } = {}) {
  return {
    id: post.id,
    title: post.title,
    audience: post.audience,
    sectors: post.sectors.map((s) => ({ id: s.sector.id, name: s.sector.name })),
    pinned: post.pinned,
    author: post.author ? { id: post.author.id, name: post.author.name, role: post.author.role.name } : null,
    blocks: post.blocks.map((b) => ({ kind: b.kind, data: b.data })),
    commentCount: post._count.comments,
    reactionCount: post._count.reactions,
    viewCount: post._count.views,
    reacted: extras.mireaccion ?? false,
    seen: extras.visto ?? false,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export async function list(user: SessionUser, opciones: { before?: string; limit?: number; q?: string }) {
  const limit = opciones.limit ?? DEFAULT_PAGE_SIZE;
  const sectores = await sectoresDe(user);
  const posts = await repo.findVisible(sectores, { before: opciones.before, limit, q: opciones.q });

  // Reacciones y vistas propias en dos consultas para toda la pagina, no una
  // por publicacion.
  const ids = posts.map((p) => p.id);
  const [reacciones, vistas] = await Promise.all([repo.findMyReactions(ids, user.id), repo.findMyViews(ids, user.id)]);
  const conReaccion = new Set(reacciones.map((r) => r.postId));
  const vistos = new Set(vistas.map((v) => v.postId));

  return {
    posts: posts.map((p) => serializar(p, { mireaccion: conReaccion.has(p.id), visto: vistos.has(p.id) })),
    hasMore: posts.length === limit,
  };
}

export async function getById(user: SessionUser, id: string) {
  const post = await traerVisible(user, id);
  const [reacciones, vistas] = await Promise.all([
    repo.findMyReactions([id], user.id),
    repo.findMyViews([id], user.id),
  ]);
  return serializar(post, { mireaccion: reacciones.length > 0, visto: vistas.length > 0 });
}

async function assertSectoresValidos(sectorIds: string[]) {
  if (!sectorIds.length) return;
  const encontrados = await prisma.sector.count({ where: { id: { in: sectorIds }, deletedAt: null } });
  if (encontrados !== new Set(sectorIds).size) {
    throw HttpError.badRequest('Alguno de los sectores elegidos no existe.');
  }
}

export async function create(user: SessionUser, data: CreatePostInput) {
  assertPuedePublicar(user);
  const sectorIds = data.audience === 'sectores' ? [...new Set(data.sectorIds)] : [];
  await assertSectoresValidos(sectorIds);

  const blocks = data.blocks as ContentBlock[];
  const post = await repo.create({
    authorId: user.id,
    title: data.title,
    audience: data.audience,
    pinned: data.pinned,
    sectorIds,
    blocks: toStored(blocks),
  });

  // Los adjuntos que usan los bloques se vinculan a la publicacion: asi la
  // rutina de huerfanos deja de contarlos como sueltos y su descarga hereda
  // el permiso de ver la publicacion.
  await attachments.linkToPost(attachmentIdsOf(blocks), post.id, user.id);

  await avisarNuevaPublicacion(post, user);
  const realtime = await import('../../realtime/realtime.emit');
  realtime.postPublished(post.id, serializar(post));
  return serializar(post);
}

export async function update(user: SessionUser, id: string, data: UpdatePostInput) {
  const existente = await repo.findById(id);
  if (!existente) throw HttpError.notFound('Publicación no encontrada.');
  assertPuedePublicar(user);
  assertPuedeAdministrar(user, existente);

  const sectorIds = data.audience === 'sectores' ? [...new Set(data.sectorIds ?? [])] : [];
  if (data.audience !== undefined) await assertSectoresValidos(sectorIds);

  const blocks = data.blocks as ContentBlock[] | undefined;
  const actualizado = await repo.update(id, {
    title: data.title,
    pinned: data.pinned,
    audience: data.audience,
    sectorIds,
    blocks: blocks ? toStored(blocks) : undefined,
  });
  if (!actualizado) throw HttpError.notFound('Publicación no encontrada.');

  if (blocks) await attachments.linkToPost(attachmentIdsOf(blocks), id, user.id);

  const realtime = await import('../../realtime/realtime.emit');
  realtime.postPublished(id, serializar(actualizado));
  return serializar(actualizado);
}

export async function remove(user: SessionUser, id: string) {
  const existente = await repo.findById(id);
  if (!existente) throw HttpError.notFound('Publicación no encontrada.');
  assertPuedePublicar(user);
  assertPuedeAdministrar(user, existente);
  // La audiencia se calcula ANTES de dar de baja: una vez marcada como
  // eliminada ya no se puede saber quienes la veian. Sin esto habia que
  // avisarle a todos los conectados, que es mas de lo necesario.
  const destinatarios = await usuariosQueVen(id, existente.audience);
  await repo.softDelete(id);
  const realtime = await import('../../realtime/realtime.emit');
  realtime.postRemoved(id, destinatarios);
}

/* ---------- Comentarios ---------- */

export async function listComments(user: SessionUser, postId: string) {
  await traerVisible(user, postId);
  const comments = await repo.findComments(postId);
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.author ? { id: c.author.id, name: c.author.name, role: c.author.role.name } : null,
    createdAt: c.createdAt,
    mine: c.authorId === user.id,
  }));
}

// Comentar lo puede hacer cualquiera que vea la publicacion, de cualquier
// rango: es la forma de que el personal responda a un aviso sin abrir un ticket.
export async function addComment(user: SessionUser, postId: string, body: string) {
  const post = await traerVisible(user, postId);
  const comment = await repo.createComment(postId, user.id, body);

  // Al autor de la publicacion se le avisa que le comentaron (salvo que se
  // comente a si mismo).
  if (post.authorId && post.authorId !== user.id) {
    await notifications.notify(
      [post.authorId],
      `${user.name} comentó en «${post.title}»`,
      'post',
      postId,
      user.id,
    );
  }

  const realtime = await import('../../realtime/realtime.emit');
  realtime.postCommented(postId, {
    id: comment.id,
    postId,
    body: comment.body,
    author: comment.author ? { id: comment.author.id, name: comment.author.name, role: comment.author.role.name } : null,
    createdAt: comment.createdAt,
  });

  return {
    id: comment.id,
    body: comment.body,
    author: comment.author ? { id: comment.author.id, name: comment.author.name, role: comment.author.role.name } : null,
    createdAt: comment.createdAt,
    mine: true,
  };
}

export async function removeComment(user: SessionUser, postId: string, commentId: string) {
  await traerVisible(user, postId);
  const comment = await repo.findCommentById(commentId);
  if (!comment || comment.postId !== postId) throw HttpError.notFound('Comentario no encontrado.');
  // Cada uno borra lo suyo; el Administrador puede borrar cualquiera.
  if (comment.authorId !== user.id && user.role !== ROLES.ADMIN) {
    throw HttpError.forbidden('Solo podés borrar tus propios comentarios.');
  }
  await repo.softDeleteComment(commentId);
  const realtime = await import('../../realtime/realtime.emit');
  realtime.postCommentRemoved(postId, commentId);
}

/* ---------- Reacciones, vistas y badge ---------- */

export async function toggleReaction(user: SessionUser, postId: string) {
  await traerVisible(user, postId);
  const reacted = await repo.toggleReaction(postId, user.id);
  const post = await repo.findById(postId);
  const count = post?._count.reactions ?? 0;
  const realtime = await import('../../realtime/realtime.emit');
  realtime.postReactionChanged(postId, count);
  return { reacted, count };
}

export async function markViewed(user: SessionUser, postId: string) {
  await traerVisible(user, postId);
  const nueva = await repo.markViewed(postId, user.id);
  return { nueva };
}

export async function listViewers(user: SessionUser, postId: string) {
  await traerVisible(user, postId);
  const vistas = await repo.findViewers(postId);
  return vistas.map((v) => ({ id: v.user.id, name: v.user.name, viewedAt: v.viewedAt }));
}

export async function unseenCount(user: SessionUser) {
  const sectores = await sectoresDe(user);
  return repo.countUnseen(user.id, sectores);
}

/** Aviso de publicacion nueva a quienes la pueden ver (menos quien publica). */
async function avisarNuevaPublicacion(post: repo.PostConDetalle, autor: SessionUser) {
  const destinatarios = await usuariosQueVen(post.id, post.audience);
  await notifications.notify(
    destinatarios,
    `Nueva publicación: ${post.title}`,
    'post',
    post.id,
    autor.id,
  );
}

/**
 * Usuarios activos que pueden ver una publicacion. Se usa para las
 * notificaciones y para el tiempo real: la lista se calcula SIEMPRE contra la
 * base, nunca a partir de algo que mande el cliente.
 */
export async function usuariosQueVen(postId: string, audience: string): Promise<string[]> {
  if (audience === 'todos') {
    const todos = await prisma.user.findMany({
      where: { deletedAt: null, status: 'Activo' },
      select: { id: true },
    });
    return todos.map((u) => u.id);
  }
  const sectores = await repo.sectorIdsOf(postId);
  const ids = sectores.map((s) => s.sectorId);
  if (!ids.length) return [];
  const usuarios = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: 'Activo',
      OR: [
        { employee: { sectorId: { in: ids }, deletedAt: null } },
        // Los Administradores ven siempre todo el feed: son quienes tienen
        // que poder auditar lo que se publica.
        { role: { name: ROLES.ADMIN } },
      ],
    },
    select: { id: true },
  });
  return usuarios.map((u) => u.id);
}

export { summaryOf };
