// AUDIENCIA DE CADA EVENTO — el punto donde vive el RBAC del tiempo real.
//
// Las validaciones de permisos de la API HTTP (middlewares requireAuth /
// requireRole, y los chequeos dentro de cada service) NO se heredan al
// WebSocket: por el socket no pasa ningun middleware de Express. Por eso el
// permiso se vuelve a resolver aca, explicitamente, para cada evento.
//
// El modelo es "solo empuje": el cliente NUNCA pide suscribirse a nada. No
// existe un mensaje `subscribe` que se pueda falsificar desde una consola del
// navegador. Antes de emitir, el servidor consulta la base y arma la lista
// exacta de usuarios habilitados; el evento sale unicamente hacia los sockets
// de esos usuarios. Un cliente manipulado no tiene forma de agregarse a una
// audiencia que no le corresponde.

import { prisma } from '../db/prisma';
import { ROLES } from '../middleware/rbac.middleware';

/** Usuarios activos con rango de soporte (Administrador o Supervisor). */
async function staffUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: 'Activo',
      role: { name: { in: [ROLES.ADMIN, ROLES.SUPERVISOR] } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Quienes pueden ver un ticket. Replica exactamente el alcance de
 * `tickets.service.list` / `getById`:
 *   - Administrador y Supervisor ven todos los tickets.
 *   - Rango User ve solo los que creo el mismo o donde es la persona a asistir.
 * Si esa regla cambia en el service, tiene que cambiar tambien aca.
 */
export async function ticketAudience(ticketId: string): Promise<string[]> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { createdById: true, employeeId: true, technicianId: true },
  });
  if (!ticket) return [];

  const ids = new Set<string>(await staffUserIds());

  // El creador, aunque sea rango User.
  if (ticket.createdById) ids.add(ticket.createdById);

  // El usuario vinculado a la persona a asistir.
  if (ticket.employeeId) {
    const afectado = await prisma.user.findFirst({
      where: { employeeId: ticket.employeeId, deletedAt: null, status: 'Activo' },
      select: { id: true },
    });
    if (afectado) ids.add(afectado.id);
  }

  // El responsable asignado (siempre es staff, pero se agrega por las dudas
  // de que en el futuro se pueda asignar a alguien fuera de esos rangos).
  if (ticket.technicianId) ids.add(ticket.technicianId);

  return [...ids];
}

/**
 * Participantes de una conversacion 1 a 1. Sin excepcion por rango: un
 * Administrador que no es parte NO recibe nada, igual que en la API.
 */
export async function conversationAudience(conversationId: string): Promise<string[]> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userAId: true, userBId: true },
  });
  if (!conversation) return [];
  return [conversation.userAId, conversation.userBId];
}

/** Integrantes de un grupo. Quien no es integrante no recibe nada. */
export async function groupAudience(groupId: string): Promise<string[]> {
  const members = await prisma.chatGroupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/**
 * Filtra una audiencia dejando solo usuarios que siguen activos. Se aplica
 * siempre antes de emitir: entre que se abrio el socket y que ocurre el
 * evento, a alguien lo pueden haber desactivado o eliminado.
 */
export async function onlyActive(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] }, deletedAt: null, status: 'Activo' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
