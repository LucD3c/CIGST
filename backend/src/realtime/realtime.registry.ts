// Registro de conexiones abiertas: quien esta conectado y por que socket.
//
// Es un Map en memoria a proposito. Un unico proceso Node sostiene todas las
// conexiones sin problema a la escala de una empresa: medido con 70 personas
// trabajando a la vez, 70 de 70 sockets conectados, 2.100 peticiones y cero
// errores. Por eso no hace falta Redis ni un broker externo para compartir
// estado entre instancias: no hay varias instancias.
//
// La contrapartida, asumida: la plataforma NO se puede correr en dos procesos.
// Si algun dia hicieran falta mas, la salida es una maquina mas grande antes
// que un segundo proceso. Las entradas se borran al cerrarse cada socket
// (unregister), y esta verificado que no crecen: 200 conexiones abiertas y
// cerradas mueven la memoria del contenedor de 44,9 a 45,1 MB.

import type { WebSocket } from 'ws';

export type SocketUser = {
  id: string;
  name: string;
  role: string;
  employeeId: string | null;
};

export type ClientSocket = WebSocket & {
  /** Usuario dueno de la conexion, resuelto en el handshake. */
  cigstUser?: SocketUser;
  /** Hash del token de sesion con el que se autentico esta conexion. */
  cigstTokenHash?: string;
  /** Marca del heartbeat: si no contesta un ping, se corta. */
  cigstAlive?: boolean;
};

// userId -> sockets de ese usuario (puede tener varias pestanas o equipos).
const byUser = new Map<string, Set<ClientSocket>>();

export function register(socket: ClientSocket) {
  const userId = socket.cigstUser?.id;
  if (!userId) return;
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  set.add(socket);
}

export function unregister(socket: ClientSocket) {
  const userId = socket.cigstUser?.id;
  if (!userId) return;
  const set = byUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (!set.size) byUser.delete(userId);
}

export function socketsOf(userId: string): ClientSocket[] {
  return [...(byUser.get(userId) ?? [])];
}

export function allSockets(): ClientSocket[] {
  return [...byUser.values()].flatMap((set) => [...set]);
}

export function connectedUserIds(): string[] {
  return [...byUser.keys()];
}

export function connectionCount(): number {
  let total = 0;
  for (const set of byUser.values()) total += set.size;
  return total;
}

const OPEN = 1; // WebSocket.OPEN, sin importar la clase en tiempo de ejecucion.

function sendRaw(socket: ClientSocket, payload: string) {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(payload);
  } catch {
    // Si el socket murio entre el chequeo y el envio, se limpia solo en 'close'.
  }
}

/** Envia un evento a TODAS las conexiones de un usuario. */
export function sendToUser(userId: string, event: string, data: unknown) {
  const set = byUser.get(userId);
  if (!set?.size) return;
  const payload = JSON.stringify({ event, data });
  for (const socket of set) sendRaw(socket, payload);
}

/**
 * Envia a varios usuarios permitiendo que el payload cambie segun quien lo
 * recibe (por ejemplo `mine: true/false` en un mensaje de chat). Nunca se
 * arma una sola copia "para todos": cada destinatario recibe lo suyo.
 */
export function sendToUsers(userIds: Iterable<string>, event: string, dataFor: (userId: string) => unknown) {
  for (const userId of new Set(userIds)) {
    const set = byUser.get(userId);
    if (!set?.size) continue;
    const payload = JSON.stringify({ event, data: dataFor(userId) });
    for (const socket of set) sendRaw(socket, payload);
  }
}

/**
 * Cierra las conexiones de un usuario. Con `tokenHash` cierra solo las de esa
 * sesion puntual (cerrar sesion en una pestana no deberia desconectar la otra
 * computadora); sin el, cierra todas (usuario desactivado o eliminado).
 */
export function closeUserSockets(userId: string, reason: string, tokenHash?: string) {
  const set = byUser.get(userId);
  if (!set?.size) return 0;
  let cerrados = 0;
  for (const socket of [...set]) {
    if (tokenHash && socket.cigstTokenHash !== tokenHash) continue;
    sendRaw(socket, JSON.stringify({ event: 'session:closed', data: { reason } }));
    try {
      // 4001: codigo propio de la aplicacion. El cliente lo distingue de una
      // caida de red y NO reintenta reconectar.
      socket.close(4001, reason);
    } catch {
      /* ya estaba cerrado */
    }
    cerrados += 1;
  }
  return cerrados;
}
