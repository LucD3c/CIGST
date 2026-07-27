import { prisma } from '../../db/prisma';

export function createForUsers(userIds: string[], title: string, targetType: string, targetId: string | null) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return Promise.resolve({ count: 0 });
  return prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, title, targetType, targetId })),
  });
}

export function findLatest(userId: string, take = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export function countUnread(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

// El where incluye userId: nadie puede marcar como leida una notificacion ajena.
export function markRead(id: string, userId: string) {
  return prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

export function markAllRead(userId: string) {
  return prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
