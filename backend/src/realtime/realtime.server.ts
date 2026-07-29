// Servidor WebSocket montado sobre el MISMO servidor HTTP de Express: mismo
// puerto, mismo origen, misma cookie. No abre un puerto nuevo ni requiere
// tocar el firewall, y todo el trafico sigue siendo interno.

import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { hashSessionToken } from '../utils/sessionToken';
import { resolveSession } from '../modules/auth/auth.service';
import * as chat from '../modules/chat/chat.service';
import * as registry from './realtime.registry';
import type { ClientSocket } from './realtime.registry';
import * as limits from './realtime.rateLimit';

/** Cada cuanto se manda ping y se revalida la sesion de cada conexion. */
const HEARTBEAT_MS = 30_000;
/** Tamano maximo de un frame entrante. Un mensaje de chat no llega ni cerca. */
const MAX_FRAME_BYTES = 64 * 1024;
/** Conexiones simultaneas aceptadas. Techo duro para no quedarse sin memoria. */
const MAX_CONNECTIONS = 400;

let wss: WebSocketServer | null = null;
let heartbeat: NodeJS.Timeout | null = null;

/** Lee una cookie del header crudo (en el upgrade no corre cookie-parser). */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const parte of header.split(';')) {
    const idx = parte.indexOf('=');
    if (idx < 0) continue;
    if (parte.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(parte.slice(idx + 1).trim());
    } catch {
      return parte.slice(idx + 1).trim();
    }
  }
  return null;
}

function rechazar(socket: Duplex, code: number, texto: string) {
  socket.write(`HTTP/1.1 ${code} ${texto}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function enviar(socket: ClientSocket, event: string, data: unknown) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({ event, data }));
  } catch {
    /* el cierre lo maneja el handler de 'close' */
  }
}

/* ---------- Mensajes que el cliente puede mandar ---------- */

type Entrante =
  | { type: 'ping' }
  | { type: 'chat:send'; conversationId?: string; groupId?: string; body?: string; attachmentIds?: string[]; ref?: string }
  | { type: 'chat:read'; conversationId?: string; groupId?: string };

async function manejarEntrante(socket: ClientSocket, raw: string) {
  const user = socket.cigstUser;
  if (!user) return;

  // Cupo general de frames: cubre cualquier cosa que mande el cliente,
  // incluidos los que no son mensajes de chat.
  if (!limits.allowFrame(user.id)) {
    enviar(socket, 'error', { message: 'Demasiadas operaciones seguidas. Esperá unos segundos.' });
    return;
  }

  let msg: Entrante;
  try {
    msg = JSON.parse(raw) as Entrante;
  } catch {
    enviar(socket, 'error', { message: 'Mensaje mal formado.' });
    return;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    enviar(socket, 'error', { message: 'Mensaje mal formado.' });
    return;
  }

  switch (msg.type) {
    case 'ping':
      enviar(socket, 'pong', { t: Date.now() });
      return;

    case 'chat:send': {
      // Cupo propio de mensajes: el mismo que rige por HTTP, para que mandar
      // por socket no sea una forma de esquivarlo.
      if (!limits.allowChatMessage(user.id)) {
        enviar(socket, 'chat:error', {
          ref: msg.ref,
          message: `Estás enviando mensajes demasiado rápido. Esperá ${limits.chatRetryAfterSeconds(user.id)} segundos.`,
        });
        return;
      }
      const body = typeof msg.body === 'string' ? msg.body.trim() : '';
      const adjuntos = Array.isArray(msg.attachmentIds) ? msg.attachmentIds.filter((x) => typeof x === 'string') : [];
      if (!body && !adjuntos.length) {
        enviar(socket, 'chat:error', { ref: msg.ref, message: 'El mensaje está vacío.' });
        return;
      }
      if (body.length > 2000) {
        enviar(socket, 'chat:error', { ref: msg.ref, message: 'El mensaje es demasiado largo.' });
        return;
      }
      try {
        // Se reusa el MISMO service que usa el endpoint HTTP: las validaciones
        // de participante/integrante y de privacidad son exactamente las
        // mismas, no una copia que pueda quedar desalineada.
        const enviado = msg.groupId
          ? await chat.sendGroupMessage(user.id, msg.groupId, body, adjuntos)
          : await chat.sendMessage(user.id, String(msg.conversationId), body, adjuntos);
        enviar(socket, 'chat:sent', { ref: msg.ref, message: enviado });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo enviar el mensaje.';
        enviar(socket, 'chat:error', { ref: msg.ref, message });
      }
      return;
    }

    case 'chat:read': {
      try {
        if (msg.groupId) await chat.markGroupRead(user.id, msg.groupId);
        else if (msg.conversationId) await chat.markRead(user.id, msg.conversationId);
      } catch {
        /* marcar como leido es best-effort: se reintenta al abrir de nuevo */
      }
      return;
    }

    default:
      enviar(socket, 'error', { message: 'Operación no reconocida.' });
  }
}

/* ---------- Arranque ---------- */

export function attachRealtime(server: HttpServer) {
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  // Handshake: se autentica ANTES de aceptar la conexion. Un socket sin
  // sesion valida nunca llega a existir.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url || !req.url.startsWith('/ws')) {
      rechazar(socket, 404, 'Not Found');
      return;
    }
    if (registry.connectionCount() >= MAX_CONNECTIONS) {
      logger.warn({ actuales: registry.connectionCount() }, 'Se alcanzó el máximo de conexiones de tiempo real');
      rechazar(socket, 503, 'Service Unavailable');
      return;
    }

    const token = readCookie(req.headers.cookie, env.SESSION_COOKIE_NAME);
    if (!token) {
      rechazar(socket, 401, 'Unauthorized');
      return;
    }

    resolveSession(token)
      .then((user) => {
        if (!user) {
          rechazar(socket, 401, 'Unauthorized');
          return;
        }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          const client = ws as ClientSocket;
          client.cigstUser = { id: user.id, name: user.name, role: user.role, employeeId: user.employeeId };
          client.cigstTokenHash = hashSessionToken(token);
          client.cigstAlive = true;
          wss!.emit('connection', client, req);
        });
      })
      .catch((err) => {
        logger.error({ err }, 'Error autenticando una conexión de tiempo real');
        rechazar(socket, 500, 'Internal Server Error');
      });
  });

  wss.on('connection', (socket: ClientSocket) => {
    registry.register(socket);
    const user = socket.cigstUser!;
    logger.info({ userId: user.id, conexiones: registry.connectionCount() }, 'Conexión de tiempo real abierta');

    enviar(socket, 'ready', { userId: user.id, role: user.role });

    socket.on('pong', () => {
      socket.cigstAlive = true;
    });

    socket.on('message', (data) => {
      void manejarEntrante(socket, data.toString());
    });

    socket.on('close', () => {
      registry.unregister(socket);
    });

    socket.on('error', (err) => {
      logger.warn({ err, userId: user.id }, 'Error en una conexión de tiempo real');
      registry.unregister(socket);
    });
  });

  // Heartbeat + revalidacion de sesion.
  //
  // El ping/pong detecta conexiones muertas que TCP todavia no cerro: cerrar
  // la tapa de una notebook o perder el wifi deja el socket "abierto" del lado
  // del servidor hasta que algo lo toca. Sin esto, esas conexiones fantasma se
  // acumulan y el usuario ve mensajes que nunca llegan.
  //
  // La revalidacion cierra el otro agujero: un socket se autentica UNA vez, y
  // sin volver a chequear seguiria vivo despues de que la sesion expire o de
  // que un Administrador desactive la cuenta. Aca se comprueba de nuevo contra
  // la base, asi el corte no depende de que todos los caminos de codigo se
  // acuerden de avisar.
  heartbeat = setInterval(() => {
    limits.sweepExpired();
    for (const socket of registry.allSockets()) {
      if (socket.cigstAlive === false) {
        registry.unregister(socket);
        socket.terminate();
        continue;
      }
      socket.cigstAlive = false;
      try {
        socket.ping();
      } catch {
        registry.unregister(socket);
      }
    }
    void revalidarSesiones();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  logger.info('Tiempo real (WebSocket) activo en /ws');
  return wss;
}

async function revalidarSesiones() {
  for (const socket of registry.allSockets()) {
    const user = socket.cigstUser;
    if (!user) continue;
    try {
      const { prisma } = await import('../db/prisma');
      const session = await prisma.session.findUnique({
        where: { tokenHash: socket.cigstTokenHash ?? '' },
        select: { expiresAt: true, user: { select: { status: true, deletedAt: true } } },
      });
      const vigente =
        session && session.expiresAt.getTime() > Date.now() && !session.user.deletedAt && session.user.status === 'Activo';
      if (!vigente) {
        enviar(socket, 'session:closed', { reason: 'Tu sesión ya no es válida.' });
        socket.close(4001, 'sesion-invalida');
        registry.unregister(socket);
      }
    } catch (err) {
      logger.error({ err }, 'Error revalidando una sesión de tiempo real');
    }
  }
}

export function stopRealtime() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  wss?.close();
  wss = null;
}

export { registry as realtimeRegistry };
