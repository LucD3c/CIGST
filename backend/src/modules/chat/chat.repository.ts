import { prisma } from '../../db/prisma';

const participantSelect = {
  id: true,
  name: true,
  status: true,
  deletedAt: true,
  role: { select: { name: true } },
} as const;

// Par canonico: el mismo par de usuarios siempre se guarda con el mismo
// orden (alfabetico por id), asi nunca se crean dos conversaciones para
// las mismas dos personas sin importar quien le escribio a quien primero.
export function canonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

export function findConversationByPair(userAId: string, userBId: string) {
  return prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    include: { userA: { select: participantSelect }, userB: { select: participantSelect } },
  });
}

export function findConversationById(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: { userA: { select: participantSelect }, userB: { select: participantSelect } },
  });
}

export function findConversationsForUser(userId: string) {
  return prisma.conversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      userA: { select: participantSelect },
      userB: { select: participantSelect },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

// Cantidad de mensajes sin leer por conversacion, para el listado. Una sola
// consulta agregada en vez de una por conversacion.
export async function countUnreadByConversation(conversationIds: string[], userId: string) {
  if (!conversationIds.length) return new Map<string, number>();
  const rows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: conversationIds }, senderId: { not: userId }, readAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.conversationId, r._count._all]));
}

export function countUnreadTotal(userId: string) {
  return prisma.message.count({
    where: {
      conversation: { OR: [{ userAId: userId }, { userBId: userId }] },
      senderId: { not: userId },
      readAt: null,
    },
  });
}

// Crea la conversacion si no existe (par canonico) y le agrega el primer
// mensaje en la misma transaccion. Si el par ya tenia conversacion, el
// mensaje simplemente se suma a la existente.
export async function startConversationWithMessage(senderId: string, recipientId: string, body: string) {
  const [userAId, userBId] = canonicalPair(senderId, recipientId);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const conversation = await tx.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: { lastMessageAt: now },
      create: { userAId, userBId, lastMessageAt: now },
      include: { userA: { select: participantSelect }, userB: { select: participantSelect } },
    });
    const message = await tx.message.create({
      data: { conversationId: conversation.id, senderId, body },
    });
    return { conversation, message };
  });
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({ data: { conversationId, senderId, body } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
    return message;
  });
}

// Paginacion por cursor (id del mensaje mas viejo ya cargado): devuelve la
// pagina siguiente hacia atras en el tiempo, mas reciente primero.
// Orden compuesto (createdAt + id) a proposito: dos mensajes seguidos pueden
// caer en el mismo milisegundo (createdAt es timestamp(3)), y con un solo
// campo de orden el cursor queda ambiguo entre esos empates y se saltean
// filas. El id (uuid) desempata de forma estable.
export function findMessagesPage(conversationId: string, before: string | undefined, limit: number) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
}

// Para el polling de la conversacion abierta: mensajes mas nuevos que el
// ultimo que ya tiene el cliente, en orden cronologico ascendente. Mismo
// desempate por id que findMessagesPage, por la misma razon.
export function findMessagesAfter(conversationId: string, afterId: string, limit: number) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    cursor: { id: afterId },
    skip: 1,
    take: limit,
  });
}

// Marca como leidos los mensajes que mando el OTRO participante (nunca los
// propios): el que lee es siempre req.user, nunca el remitente original.
export function markConversationRead(conversationId: string, readerUserId: string) {
  return prisma.message.updateMany({
    where: { conversationId, senderId: { not: readerUserId }, readAt: null },
    data: { readAt: new Date() },
  });
}

export function findActiveUser(id: string) {
  return prisma.user.findFirst({ where: { id, deletedAt: null, status: 'Activo' }, select: { id: true } });
}

export function findMessageById(id: string) {
  return prisma.message.findUnique({ where: { id }, select: { id: true, conversationId: true, groupId: true } });
}

// Incluye el sector de la persona vinculada: al armar un grupo o elegir a
// quien escribirle, saber de que area es cada uno evita confundir homonimos.
export function findDirectory(excludingUserId: string) {
  return prisma.user.findMany({
    where: { deletedAt: null, status: 'Activo', id: { not: excludingUserId } },
    select: {
      id: true,
      name: true,
      role: { select: { name: true } },
      employee: { select: { sector: { select: { name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
}

/* ---------- Grupos ---------- */

const groupInclude = {
  members: { include: { user: { select: { id: true, name: true, role: { select: { name: true } } } } } },
} as const;

export function createGroup(name: string, creatorId: string, memberIds: string[]) {
  const unique = [...new Set([creatorId, ...memberIds])];
  return prisma.chatGroup.create({
    data: {
      name,
      createdById: creatorId,
      members: { create: unique.map((userId) => ({ userId })) },
    },
    include: groupInclude,
  });
}

export function findGroupById(id: string) {
  return prisma.chatGroup.findUnique({ where: { id }, include: groupInclude });
}

export function findGroupsForUser(userId: string) {
  return prisma.chatGroup.findMany({
    where: { members: { some: { userId } } },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      ...groupInclude,
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true } } } },
    },
  });
}

// Reemplaza la lista de miembros por la nueva (los que salen pierden acceso,
// los que entran arrancan con lastReadAt vacio) y renombra si corresponde.
export function updateGroup(id: string, data: { name?: string; memberIds?: string[] }) {
  return prisma.$transaction(async (tx) => {
    if (data.name !== undefined) {
      await tx.chatGroup.update({ where: { id }, data: { name: data.name } });
    }
    if (data.memberIds !== undefined) {
      const unique = [...new Set(data.memberIds)];
      await tx.chatGroupMember.deleteMany({ where: { groupId: id, userId: { notIn: unique } } });
      const existing = await tx.chatGroupMember.findMany({ where: { groupId: id }, select: { userId: true } });
      const existingIds = new Set(existing.map((m) => m.userId));
      const toAdd = unique.filter((uid) => !existingIds.has(uid));
      if (toAdd.length) {
        await tx.chatGroupMember.createMany({ data: toAdd.map((userId) => ({ groupId: id, userId })) });
      }
    }
    return tx.chatGroup.findUnique({ where: { id }, include: groupInclude });
  });
}

export function deleteGroup(id: string) {
  return prisma.chatGroup.delete({ where: { id } });
}

export function findGroupMember(groupId: string, userId: string) {
  return prisma.chatGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
}

export async function sendGroupMessage(groupId: string, senderId: string, body: string) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { groupId, senderId, body },
      include: { sender: { select: { id: true, name: true } } },
    });
    await tx.chatGroup.update({ where: { id: groupId }, data: { lastMessageAt: message.createdAt } });
    return message;
  });
}

export function findGroupMessagesPage(groupId: string, before: string | undefined, limit: number) {
  return prisma.message.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { sender: { select: { id: true, name: true } } },
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
}

export function findGroupMessagesAfter(groupId: string, afterId: string, limit: number) {
  return prisma.message.findMany({
    where: { groupId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    cursor: { id: afterId },
    skip: 1,
    take: limit,
    include: { sender: { select: { id: true, name: true } } },
  });
}

export function markGroupRead(groupId: string, userId: string) {
  return prisma.chatGroupMember.update({
    where: { groupId_userId: { groupId, userId } },
    data: { lastReadAt: new Date() },
  });
}

// Mensajes de OTROS posteriores a mi ultima lectura, por grupo.
export function countGroupUnread(groupId: string, userId: string, lastReadAt: Date | null) {
  return prisma.message.count({
    where: {
      groupId,
      senderId: { not: userId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
}

export function findMembershipsForUser(userId: string) {
  return prisma.chatGroupMember.findMany({ where: { userId }, select: { groupId: true, lastReadAt: true } });
}
