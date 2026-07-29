import { HttpError } from '../../utils/httpError';
import { sortByName } from '../../utils/sortByName';
import * as repo from './chat.repository';
import * as notifications from '../notifications/notifications.service';
import * as attachments from '../attachments/attachments.service';
import * as realtime from '../../realtime/realtime.emit';

type AttachmentView = { id: string; originalName: string; mimeType: string; size: number };

const DEFAULT_PAGE_SIZE = 30;

type ConversationWithParticipants = NonNullable<Awaited<ReturnType<typeof repo.findConversationById>>>;
type Participant = ConversationWithParticipants['userA'];

// Privacidad del chat: nadie (ni Administrador) puede leer/escribir una
// conversacion de la que no es parte. No hay bypass por rol a proposito.
function assertParticipant(conversation: { userAId: string; userBId: string }, userId: string) {
  if (conversation.userAId !== userId && conversation.userBId !== userId) {
    throw HttpError.forbidden('No podés acceder a esta conversación.');
  }
}

function otherParticipant(
  conversation: { userAId: string; userBId: string; userA: Participant; userB: Participant },
  userId: string,
): Participant {
  return conversation.userAId === userId ? conversation.userB : conversation.userA;
}

async function getConversationOrThrow(conversationId: string) {
  const conversation = await repo.findConversationById(conversationId);
  if (!conversation) throw HttpError.notFound('Conversación no encontrada.');
  return conversation;
}

function shapeMessage(currentUserId: string) {
  return (m: { id: string; conversationId: string | null; senderId: string; body: string; createdAt: Date; readAt: Date | null }) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt,
    readAt: m.readAt,
    mine: m.senderId === currentUserId,
  });
}

// Enriquece una tanda de mensajes con sus adjuntos en UNA sola consulta
// (no una por burbuja).
async function withAttachments<T extends { id: string }>(messages: T[]) {
  if (!messages.length) return messages.map((m) => ({ ...m, attachments: [] as AttachmentView[] }));
  const map = await attachments.mapByMessages(messages.map((m) => m.id));
  return messages.map((m) => ({ ...m, attachments: map.get(m.id) ?? [] }));
}

export async function listConversations(currentUserId: string) {
  const conversations = await repo.findConversationsForUser(currentUserId);
  const unreadMap = await repo.countUnreadByConversation(conversations.map((c) => c.id), currentUserId);

  return conversations.map((c) => {
    const other = otherParticipant(c, currentUserId);
    const last = c.messages[0];
    return {
      id: c.id,
      otherUser: { id: other.id, name: other.name, role: other.role.name, status: other.status },
      lastMessage: last
        ? { body: last.body, senderId: last.senderId, createdAt: last.createdAt, mine: last.senderId === currentUserId }
        : null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unreadMap.get(c.id) ?? 0,
    };
  });
}

export async function startConversation(
  currentUserId: string,
  recipientId: string,
  body: string,
  attachmentIds?: string[],
) {
  if (recipientId === currentUserId) {
    throw HttpError.badRequest('No podés iniciar una conversación con vos mismo.');
  }
  const recipient = await repo.findActiveUser(recipientId);
  if (!recipient) throw HttpError.badRequest('Ese usuario no existe o no está activo.');

  const { conversation, message } = await repo.startConversationWithMessage(currentUserId, recipientId, body);
  await attachments.linkToMessage(attachmentIds, message.id, currentUserId);
  const other = otherParticipant(conversation, currentUserId);
  const [shaped] = await withAttachments([shapeMessage(currentUserId)(message)]);
  // Primer mensaje de una conversacion nueva: al destinatario le tiene que
  // aparecer sin recargar, igual que cualquier otro.
  if (shaped) realtime.chatMessageSent(conversation.id, shaped);
  return {
    conversation: {
      id: conversation.id,
      otherUser: { id: other.id, name: other.name, role: other.role.name, status: other.status },
      lastMessageAt: conversation.lastMessageAt,
    },
    message: shaped,
  };
}

async function assertCursorBelongsToConversation(cursorId: string, conversationId: string) {
  const cursor = await repo.findMessageById(cursorId);
  if (!cursor || cursor.conversationId !== conversationId) {
    throw HttpError.badRequest('El cursor de mensajes indicado no es válido para esta conversación.');
  }
}

// Historial paginado (mas viejo primero al renderizar): antes de `before`.
export async function getMessages(currentUserId: string, conversationId: string, before: string | undefined, limit: number | undefined) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);
  if (before) await assertCursorBelongsToConversation(before, conversationId);

  const pageSize = limit ?? DEFAULT_PAGE_SIZE;
  const rows = await repo.findMessagesPage(conversationId, before, pageSize);
  const chronological = [...rows].reverse();
  return {
    messages: await withAttachments(chronological.map(shapeMessage(currentUserId))),
    hasMore: rows.length === pageSize,
  };
}

export async function sendMessage(
  currentUserId: string,
  conversationId: string,
  body: string,
  attachmentIds?: string[],
) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);

  const other = otherParticipant(conversation, currentUserId);
  if (other.status !== 'Activo' || other.deletedAt) {
    throw HttpError.badRequest('Ese usuario ya no está activo en la plataforma.');
  }

  const message = await repo.sendMessage(conversationId, currentUserId, body);
  await attachments.linkToMessage(attachmentIds, message.id, currentUserId);
  const [shaped] = await withAttachments([shapeMessage(currentUserId)(message)]);
  // Entrega inmediata a los dos participantes (y a nadie mas: la audiencia la
  // resuelve realtime.audience contra la base, no el cliente).
  if (shaped) realtime.chatMessageSent(conversationId, shaped);
  return shaped;
}

// El que "lee" es siempre quien llama a este endpoint: solo se marcan como
// leidos los mensajes que mando la OTRA persona, nunca los propios.
export async function markRead(currentUserId: string, conversationId: string) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);
  await repo.markConversationRead(conversationId, currentUserId);
  realtime.chatConversationRead(conversationId, currentUserId);
}

// No leidos totales: 1 a 1 + grupos (para el badge de "Mensajes").
export async function unreadTotal(currentUserId: string) {
  const direct = await repo.countUnreadTotal(currentUserId);
  const memberships = await repo.findMembershipsForUser(currentUserId);
  const groupCounts = await Promise.all(
    memberships.map((m) => repo.countGroupUnread(m.groupId, currentUserId, m.lastReadAt)),
  );
  return direct + groupCounts.reduce((a, b) => a + b, 0);
}

export async function directory(currentUserId: string) {
  const users = await repo.findDirectory(currentUserId);
  return sortByName(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role.name,
      sectorName: u.employee?.sector?.name ?? '',
    })),
    (u) => u.name,
  );
}

/* ---------- Grupos ---------- */

async function getGroupOrThrow(groupId: string) {
  const group = await repo.findGroupById(groupId);
  if (!group) throw HttpError.notFound('Grupo no encontrado.');
  return group;
}

// La membresia es la unica llave de acceso a un grupo. El Administrador que
// no es miembro tampoco lee: mismos principios de privacidad que el 1 a 1
// (el admin administra miembros, pero para leer/escribir debe estar dentro,
// y al crear el grupo queda incluido automaticamente).
async function assertGroupMember(groupId: string, userId: string) {
  const member = await repo.findGroupMember(groupId, userId);
  if (!member) throw HttpError.forbidden('No sos miembro de este grupo.');
  return member;
}

export async function listGroups(currentUserId: string) {
  const groups = await repo.findGroupsForUser(currentUserId);
  const unread = await Promise.all(
    groups.map((g) => {
      const me = g.members.find((m) => m.userId === currentUserId);
      return repo.countGroupUnread(g.id, currentUserId, me?.lastReadAt ?? null);
    }),
  );
  return groups.map((g, i) => ({
    id: g.id,
    name: g.name,
    memberCount: g.members.length,
    members: g.members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.user.role.name })),
    lastMessage: g.messages[0]
      ? {
          body: g.messages[0].body,
          senderName: g.messages[0].sender.name,
          createdAt: g.messages[0].createdAt,
          mine: g.messages[0].senderId === currentUserId,
        }
      : null,
    lastMessageAt: g.lastMessageAt,
    unreadCount: unread[i],
  }));
}

export async function createGroup(currentUserId: string, name: string, memberIds: string[]) {
  for (const memberId of memberIds) {
    const active = await repo.findActiveUser(memberId);
    if (!active) throw HttpError.badRequest('Uno de los usuarios elegidos no existe o no está activo.');
  }
  const group = await repo.createGroup(name, currentUserId, memberIds);
  await notifications.notify(
    group.members.map((m) => m.userId),
    `Te agregaron al grupo «${group.name}»`,
    'group',
    group.id,
    currentUserId,
  );
  return group;
}

export async function updateGroup(currentUserId: string, groupId: string, data: { name?: string; memberIds?: string[] }) {
  const existing = await getGroupOrThrow(groupId);
  if (data.memberIds !== undefined) {
    if (!data.memberIds.length) throw HttpError.badRequest('Un grupo necesita al menos un miembro.');
    for (const memberId of data.memberIds) {
      const active = await repo.findActiveUser(memberId);
      if (!active) throw HttpError.badRequest('Uno de los usuarios elegidos no existe o no está activo.');
    }
  }
  const updated = await repo.updateGroup(groupId, data);
  if (data.memberIds !== undefined && updated) {
    const previousIds = new Set(existing.members.map((m) => m.userId));
    const added = updated.members.filter((m) => !previousIds.has(m.userId));
    await notifications.notify(
      added.map((m) => m.userId),
      `Te agregaron al grupo «${updated.name}»`,
      'group',
      updated.id,
      currentUserId,
    );
  }
  return updated;
}

export async function removeGroup(groupId: string) {
  await getGroupOrThrow(groupId);
  await repo.deleteGroup(groupId);
}

function shapeGroupMessage(currentUserId: string) {
  return (m: { id: string; groupId: string | null; senderId: string; body: string; createdAt: Date; sender: { id: string; name: string } }) => ({
    id: m.id,
    groupId: m.groupId,
    senderId: m.senderId,
    senderName: m.sender.name,
    body: m.body,
    createdAt: m.createdAt,
    mine: m.senderId === currentUserId,
  });
}

export async function getGroupMessages(currentUserId: string, groupId: string, before: string | undefined, limit: number | undefined) {
  await getGroupOrThrow(groupId);
  await assertGroupMember(groupId, currentUserId);
  if (before) {
    const cursor = await repo.findMessageById(before);
    if (!cursor || cursor.groupId !== groupId) throw HttpError.badRequest('El cursor de mensajes indicado no es válido para este grupo.');
  }
  const pageSize = limit ?? DEFAULT_PAGE_SIZE;
  const rows = await repo.findGroupMessagesPage(groupId, before, pageSize);
  return {
    messages: await withAttachments([...rows].reverse().map(shapeGroupMessage(currentUserId))),
    hasMore: rows.length === pageSize,
  };
}

export async function sendGroupMessage(
  currentUserId: string,
  groupId: string,
  body: string,
  attachmentIds?: string[],
) {
  await getGroupOrThrow(groupId);
  await assertGroupMember(groupId, currentUserId);
  const message = await repo.sendGroupMessage(groupId, currentUserId, body);
  await attachments.linkToMessage(attachmentIds, message.id, currentUserId);
  const [shaped] = await withAttachments([shapeGroupMessage(currentUserId)(message)]);
  if (shaped) realtime.chatGroupMessageSent(groupId, shaped);
  return shaped;
}

export async function markGroupRead(currentUserId: string, groupId: string) {
  await getGroupOrThrow(groupId);
  await assertGroupMember(groupId, currentUserId);
  await repo.markGroupRead(groupId, currentUserId);
  realtime.chatGroupRead(groupId, currentUserId);
}
