import * as repo from './notifications.repository';

// Punto unico de emision: otros modulos (tickets, chat) llaman aca. Nunca se
// notifica al propio autor de la accion (excludeUserId).
export async function notify(
  userIds: (string | null | undefined)[],
  title: string,
  targetType: 'ticket' | 'chat' | 'group' | 'post',
  targetId: string | null,
  excludeUserId?: string,
) {
  const targets = userIds.filter((id): id is string => Boolean(id) && id !== excludeUserId);
  if (!targets.length) return;
  // Si la escritura de la notificacion falla no debe romper la accion
  // principal (el ticket/mensaje ya se guardo): se registra y sigue.
  try {
    await repo.createForUsers(targets, title, targetType, targetId);
  } catch (err) {
    console.error('No se pudo crear la notificacion:', err);
    return;
  }
  // Empuje inmediato a cada destinatario: la campanita se actualiza sola, sin
  // que el navegador tenga que preguntar cada 15 segundos.
  const realtime = await import('../../realtime/realtime.emit');
  await Promise.all(
    targets.map(async (userId) => {
      const count = await repo.countUnread(userId).catch(() => 0);
      realtime.notificationCreated(userId, { title, targetType, targetId, createdAt: new Date() }, count);
    }),
  );
}

export async function listForUser(userId: string) {
  const [notifications, unreadCount] = await Promise.all([repo.findLatest(userId), repo.countUnread(userId)]);
  return { notifications, unreadCount };
}

export function unreadCount(userId: string) {
  return repo.countUnread(userId);
}

export function markRead(id: string, userId: string) {
  return repo.markRead(id, userId);
}

export function markAllRead(userId: string) {
  return repo.markAllRead(userId);
}
