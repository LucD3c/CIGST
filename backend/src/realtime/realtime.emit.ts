// API de emision que usan los services. Cada funcion resuelve primero la
// audiencia (RBAC) y recien despues envia. Ningun service manda nada "a todos".
//
// Todo lo de aca es best-effort y no debe romper la operacion HTTP que lo
// disparo: si el tiempo real falla, el mensaje o el ticket igual quedaron
// guardados y el cliente los ve al recargar. Por eso cada emision atrapa sus
// propios errores.

import { logger } from '../utils/logger';
import * as registry from './realtime.registry';
import * as audience from './realtime.audience';

type ChatMessagePayload = {
  id: string;
  conversationId?: string | null;
  groupId?: string | null;
  senderId: string;
  senderName?: string;
  body: string;
  createdAt: Date | string;
  readAt?: Date | string | null;
  attachments?: unknown[];
};

function safe(nombre: string, fn: () => Promise<void>) {
  fn().catch((err) => logger.error({ err, evento: nombre }, 'No se pudo emitir un evento de tiempo real'));
}

/**
 * Mensaje nuevo en una conversacion 1 a 1. Solo los dos participantes.
 * `mine` se calcula para cada destinatario: la misma burbuja es "mía" para
 * quien la mando y "del otro" para quien la recibe.
 */
export function chatMessageSent(conversationId: string, message: ChatMessagePayload) {
  safe('chat:message', async () => {
    const destinatarios = await audience.onlyActive(await audience.conversationAudience(conversationId));
    registry.sendToUsers(destinatarios, 'chat:message', (userId) => ({
      ...message,
      conversationId,
      groupId: null,
      mine: message.senderId === userId,
    }));
    await emitUnreadFor(destinatarios.filter((id) => id !== message.senderId));
  });
}

/** Mensaje nuevo en un grupo. Solo sus integrantes. */
export function chatGroupMessageSent(groupId: string, message: ChatMessagePayload) {
  safe('chat:message(grupo)', async () => {
    const destinatarios = await audience.onlyActive(await audience.groupAudience(groupId));
    registry.sendToUsers(destinatarios, 'chat:message', (userId) => ({
      ...message,
      groupId,
      conversationId: null,
      mine: message.senderId === userId,
    }));
    await emitUnreadFor(destinatarios.filter((id) => id !== message.senderId));
  });
}

/**
 * Alguien leyo los mensajes de una conversacion: se le avisa al OTRO
 * participante para que actualice el estado de sus burbujas y su badge.
 */
export function chatConversationRead(conversationId: string, readerUserId: string) {
  safe('chat:read', async () => {
    const participantes = await audience.onlyActive(await audience.conversationAudience(conversationId));
    const otros = participantes.filter((id) => id !== readerUserId);
    registry.sendToUsers(otros, 'chat:read', () => ({ conversationId, readerUserId }));
    await emitUnreadFor([readerUserId]);
  });
}

export function chatGroupRead(groupId: string, readerUserId: string) {
  safe('chat:read(grupo)', async () => {
    await emitUnreadFor([readerUserId]);
  });
}

/**
 * Badge global de no leidos. Se recalcula por usuario con la misma funcion
 * que usa el endpoint HTTP, asi el numero no depende del transporte.
 */
export async function emitUnreadFor(userIds: string[]) {
  const conectados = userIds.filter((id) => registry.socketsOf(id).length > 0);
  if (!conectados.length) return;
  // Import diferido: chat.service importa este modulo, importarlo arriba
  // crearia un ciclo.
  const chat = await import('../modules/chat/chat.service');
  await Promise.all(
    conectados.map(async (userId) => {
      try {
        const count = await chat.unreadTotal(userId);
        registry.sendToUser(userId, 'chat:unread', { count });
      } catch (err) {
        logger.error({ err, userId }, 'No se pudo recalcular el badge de no leidos');
      }
    }),
  );
}

/** Ticket creado o modificado: solo a quienes tienen permiso de verlo. */
export function ticketChanged(kind: 'ticket:created' | 'ticket:updated', ticketId: string, resumen: unknown) {
  safe(kind, async () => {
    const destinatarios = await audience.onlyActive(await audience.ticketAudience(ticketId));
    registry.sendToUsers(destinatarios, kind, () => resumen);
  });
}

/** Notificacion nueva para una persona puntual. */
export function notificationCreated(userId: string, notification: unknown, unreadCount: number) {
  safe('notification:new', async () => {
    const [activo] = await audience.onlyActive([userId]);
    if (!activo) return;
    registry.sendToUser(activo, 'notification:new', { notification, unreadCount });
  });
}

/**
 * Cierra los sockets de un usuario. Se llama al cerrar sesion (solo esa
 * sesion) y al desactivar o eliminar la cuenta (todas).
 */
export function closeSocketsForUser(userId: string, reason: string, tokenHash?: string) {
  const cerrados = registry.closeUserSockets(userId, reason, tokenHash);
  if (cerrados) logger.info({ userId, cerrados, reason }, 'Conexiones de tiempo real cerradas');
  return cerrados;
}
