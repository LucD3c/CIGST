import fs from 'node:fs';
import { HttpError } from '../../utils/httpError';
import { prisma } from '../../db/prisma';
import { logger } from '../../utils/logger';
import { ROLES } from '../../middleware/rbac.middleware';
import type { SessionUser } from '../auth/auth.service';
import * as repo from './attachments.repository';
import { sniffMimeType, deleteFileQuiet, filePathFor } from './attachments.storage';

const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // cada 6 h

// Registra un archivo ya escrito en disco por multer. El tipo se determina
// leyendo los bytes reales: si no coincide con ningun formato permitido, el
// archivo se borra y la subida se rechaza (no alcanza con que la extension o
// el Content-Type declarado sean validos).
export async function register(file: Express.Multer.File, userId: string) {
  const mimeType = sniffMimeType(file.path, file.originalname);
  if (!mimeType) {
    deleteFileQuiet(file.filename);
    throw HttpError.badRequest(
      `"${file.originalname}" no es un archivo válido. Se aceptan imágenes (PNG, JPG, GIF, WEBP), PDF y planillas (XLSX, XLS, CSV).`,
    );
  }
  return repo.create({
    storedName: file.filename,
    originalName: file.originalname.slice(0, 255),
    mimeType,
    size: file.size,
    uploadedById: userId,
  });
}

// Valida que los ids sean adjuntos propios y todavia sin vincular. Devuelve
// los ids validados; si alguno no lo es, corta con 400 (asi un ticket o
// mensaje nunca queda a medias con adjuntos ajenos).
async function assertOwnLoose(ids: string[], userId: string) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await repo.findLooseOwnedByUser(unique, userId);
  if (found.length !== unique.length) {
    throw HttpError.badRequest('Alguno de los archivos adjuntos ya no está disponible. Volvé a adjuntarlo.');
  }
  return unique;
}

export async function linkToTicket(ids: string[] | undefined, ticketId: string, userId: string) {
  const valid = await assertOwnLoose(ids ?? [], userId);
  if (valid.length) await repo.attachToTicket(valid, ticketId);
}

export async function linkToMessage(ids: string[] | undefined, messageId: string, userId: string) {
  const valid = await assertOwnLoose(ids ?? [], userId);
  if (valid.length) await repo.attachToMessage(valid, messageId);
}

/**
 * Vincula los adjuntos que usan los bloques de una publicacion, y desvincula
 * los que dejaron de usarse. A diferencia de tickets y mensajes, aca el
 * contenido se EDITA: al volver a guardar llegan ids que ya pertenecen a esta
 * misma publicacion, y tienen que seguir siendo validos.
 */
export async function linkToPost(ids: string[], postId: string, userId: string) {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const found = await repo.findReusableForTarget(unique, userId, { postId });
    if (found.length !== unique.length) {
      throw HttpError.badRequest('Alguna de las imágenes ya no está disponible. Volvé a subirla.');
    }
    await repo.attachToPost(unique, postId);
  }
  await repo.detachFromPostExcept(postId, unique);
}

export async function linkToArticle(ids: string[], articleId: string, userId: string) {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const found = await repo.findReusableForTarget(unique, userId, { articleId });
    if (found.length !== unique.length) {
      throw HttpError.badRequest('Alguna de las imágenes ya no está disponible. Volvé a subirla.');
    }
    await repo.attachToArticle(unique, articleId);
  }
  await repo.detachFromArticleExcept(articleId, unique);
}

// Igual que en tickets.service: staff ve todo, User solo lo suyo.
async function canReadTicket(user: SessionUser, ticketId: string) {
  if (user.role === ROLES.ADMIN || user.role === ROLES.SUPERVISOR) return true;
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { employeeId: true, createdById: true },
  });
  if (!ticket) return false;
  return ticket.createdById === user.id || (Boolean(user.employeeId) && ticket.employeeId === user.employeeId);
}

// Igual que en chat.service: solo participantes del 1 a 1 o miembros del
// grupo -- sin excepcion por rol, tampoco para Administrador.
async function canReadMessage(user: SessionUser, messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      conversation: { select: { userAId: true, userBId: true } },
      group: { select: { members: { select: { userId: true } } } },
    },
  });
  if (!message) return false;
  if (message.conversation) {
    return message.conversation.userAId === user.id || message.conversation.userBId === user.id;
  }
  if (message.group) {
    return message.group.members.some((m) => m.userId === user.id);
  }
  return false;
}

// Devuelve los datos para servir el archivo, recien despues de comprobar que
// quien pide tiene derecho a ver el ticket/mensaje que lo contiene.
// El permiso de una imagen del feed es el de la publicacion que la contiene:
// si la publicacion va a un sector, su imagen tambien.
async function canReadPost(user: SessionUser, postId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true, audience: true, authorId: true },
  });
  if (!post) return false;
  const feed = await import('../feed/feed.service');
  return feed.puedeVer(user, post);
}

// Y el de una imagen de una base de conocimiento es el de esa base.
async function canReadArticle(user: SessionUser, articleId: string) {
  const article = await prisma.kbArticle.findFirst({
    where: { id: articleId, deletedAt: null },
    select: { section: { select: { spaceId: true } } },
  });
  if (!article) return false;
  const permisos = await import('../knowledge/knowledge.permissions');
  return (await permisos.nivelDe(user, article.section.spaceId)) !== null;
}

export async function getForDownload(user: SessionUser, id: string) {
  const attachment = await repo.findById(id);
  if (!attachment) throw HttpError.notFound('Archivo no encontrado.');

  let allowed = false;
  if (attachment.ticketId) allowed = await canReadTicket(user, attachment.ticketId);
  else if (attachment.messageId) allowed = await canReadMessage(user, attachment.messageId);
  else if (attachment.postId) allowed = await canReadPost(user, attachment.postId);
  else if (attachment.articleId) allowed = await canReadArticle(user, attachment.articleId);
  else allowed = attachment.uploadedById === user.id; // todavia sin enviar

  if (!allowed) throw HttpError.forbidden('No tenés acceso a este archivo.');

  const absolutePath = filePathFor(attachment.storedName);
  if (!fs.existsSync(absolutePath)) throw HttpError.notFound('El archivo ya no está disponible.');

  return { attachment, absolutePath };
}

export function listByTicket(ticketId: string) {
  return repo.findByTicket(ticketId);
}

// Adjuntos de varios mensajes en una sola consulta, agrupados por mensaje:
// evita una consulta por burbuja al pintar una conversacion.
export async function mapByMessages(messageIds: string[]) {
  const rows = await repo.findByMessageIds(messageIds);
  const map = new Map<string, { id: string; originalName: string; mimeType: string; size: number }[]>();
  for (const row of rows) {
    if (!row.messageId) continue;
    const list = map.get(row.messageId) ?? [];
    list.push({ id: row.id, originalName: row.originalName, mimeType: row.mimeType, size: row.size });
    map.set(row.messageId, list);
  }
  return map;
}

// Borra adjuntos que quedaron sueltos (se subieron pero nunca se envio el
// ticket/mensaje). Corre al arrancar y cada 6 h: mantiene el disco acotado
// sin necesidad de mantenimiento manual.
export async function cleanupOrphans() {
  try {
    const orphans = await repo.findOrphansOlderThan(new Date(Date.now() - ORPHAN_MAX_AGE_MS));
    if (!orphans.length) return 0;
    for (const orphan of orphans) deleteFileQuiet(orphan.storedName);
    await repo.deleteMany(orphans.map((o) => o.id));
    logger.info({ count: orphans.length }, 'Adjuntos sueltos eliminados');
    return orphans.length;
  } catch (err) {
    logger.error({ err }, 'Fallo la limpieza de adjuntos sueltos');
    return 0;
  }
}

export function startOrphanCleanup() {
  void cleanupOrphans();
  const timer = setInterval(() => void cleanupOrphans(), CLEANUP_INTERVAL_MS);
  timer.unref();
}
