// Cupo de mensajes por WebSocket.
//
// `express-rate-limit` es middleware HTTP: no ve un solo byte de lo que entra
// por el socket. Sin esto, alguien con una consola del navegador abierta
// podria mandar miles de frames por segundo por una conexion ya autenticada
// y saltearse por completo el limite de 30 mensajes/minuto que rige en
// `POST /api/chat/...`. Este limitador cubre ese hueco con el MISMO cupo, para
// que el limite efectivo no dependa del transporte que use el cliente.

const WINDOW_MS = 60 * 1000;

/** Mensajes de chat por usuario por minuto. Igual que `chatMessageRateLimiter`. */
export const CHAT_MESSAGES_PER_MINUTE = 30;

/**
 * Frames de cualquier tipo por usuario por minuto. Mas alto que el de
 * mensajes porque incluye marcar como leido y el ping del cliente, pero
 * acotado para que un cliente enloquecido no consuma CPU del servidor.
 */
export const FRAMES_PER_MINUTE = 240;

type Bucket = { count: number; resetAt: number };

const chatBuckets = new Map<string, Bucket>();
const frameBuckets = new Map<string, Bucket>();

function consume(buckets: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** true si el usuario todavia tiene cupo para mandar un mensaje de chat. */
export function allowChatMessage(userId: string): boolean {
  return consume(chatBuckets, userId, CHAT_MESSAGES_PER_MINUTE);
}

/** true si el usuario todavia tiene cupo para mandar un frame cualquiera. */
export function allowFrame(userId: string): boolean {
  return consume(frameBuckets, userId, FRAMES_PER_MINUTE);
}

/** Segundos que faltan para que se libere el cupo de chat (para el aviso). */
export function chatRetryAfterSeconds(userId: string): number {
  const bucket = chatBuckets.get(userId);
  if (!bucket) return 0;
  return Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}

export function forget(userId: string) {
  chatBuckets.delete(userId);
  frameBuckets.delete(userId);
}

/**
 * Limpieza periodica de ventanas vencidas: sin esto el Map crece con cada
 * usuario que alguna vez se conecto y nunca se achica.
 */
export function sweepExpired() {
  const now = Date.now();
  for (const buckets of [chatBuckets, frameBuckets]) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
}
