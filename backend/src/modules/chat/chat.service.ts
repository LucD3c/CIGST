import { HttpError } from '../../utils/httpError';
import * as repo from './chat.repository';

const DEFAULT_PAGE_SIZE = 30;
const POLL_PAGE_SIZE = 50;

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
  return (m: { id: string; conversationId: string; senderId: string; body: string; createdAt: Date; readAt: Date | null }) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt,
    readAt: m.readAt,
    mine: m.senderId === currentUserId,
  });
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

export async function startConversation(currentUserId: string, recipientId: string, body: string) {
  if (recipientId === currentUserId) {
    throw HttpError.badRequest('No podés iniciar una conversación con vos mismo.');
  }
  const recipient = await repo.findActiveUser(recipientId);
  if (!recipient) throw HttpError.badRequest('Ese usuario no existe o no está activo.');

  const { conversation, message } = await repo.startConversationWithMessage(currentUserId, recipientId, body);
  const other = otherParticipant(conversation, currentUserId);
  return {
    conversation: {
      id: conversation.id,
      otherUser: { id: other.id, name: other.name, role: other.role.name, status: other.status },
      lastMessageAt: conversation.lastMessageAt,
    },
    message: shapeMessage(currentUserId)(message),
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
    messages: chronological.map(shapeMessage(currentUserId)),
    hasMore: rows.length === pageSize,
  };
}

// Polling de la conversacion abierta: mensajes nuevos despues de `after`.
export async function pollNewMessages(currentUserId: string, conversationId: string, afterId: string) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);
  await assertCursorBelongsToConversation(afterId, conversationId);

  const rows = await repo.findMessagesAfter(conversationId, afterId, POLL_PAGE_SIZE);
  return rows.map(shapeMessage(currentUserId));
}

export async function sendMessage(currentUserId: string, conversationId: string, body: string) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);

  const other = otherParticipant(conversation, currentUserId);
  if (other.status !== 'Activo' || other.deletedAt) {
    throw HttpError.badRequest('Ese usuario ya no está activo en la plataforma.');
  }

  const message = await repo.sendMessage(conversationId, currentUserId, body);
  return shapeMessage(currentUserId)(message);
}

// El que "lee" es siempre quien llama a este endpoint: solo se marcan como
// leidos los mensajes que mando la OTRA persona, nunca los propios.
export async function markRead(currentUserId: string, conversationId: string) {
  const conversation = await getConversationOrThrow(conversationId);
  assertParticipant(conversation, currentUserId);
  await repo.markConversationRead(conversationId, currentUserId);
}

export async function unreadTotal(currentUserId: string) {
  return repo.countUnreadTotal(currentUserId);
}

export async function directory(currentUserId: string) {
  const users = await repo.findDirectory(currentUserId);
  return users.map((u) => ({ id: u.id, name: u.name, role: u.role.name }));
}
