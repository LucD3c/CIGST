import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Limita intentos de login por IP: suficiente para frenar fuerza bruta basica
// sin molestar a un uso normal (alguien que erra la contrasena un par de veces).
export const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Esperá unos minutos e intentá nuevamente.' },
});

// Limita el envio de mensajes de chat por usuario (no por IP: varios
// empleados de la misma oficina comparten salida a internet). Generoso para
// una conversacion real, suficiente para frenar un flood/script.
export const chatMessageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Estás enviando mensajes demasiado rápido. Esperá unos segundos e intentá nuevamente.' },
});

// Subida de archivos: mas acotado que el limite general porque cada pedido
// consume disco, no solo CPU. 40 subidas por usuario cada 10 minutos cubre
// de sobra el uso real (adjuntar unas capturas a un ticket o a un chat) y
// frena que un script llene el volumen de uploads.
export const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Estás subiendo archivos demasiado rápido. Esperá unos minutos e intentá nuevamente.' },
});

// Defensa en profundidad para el resto de la API: no reemplaza a los limites
// especificos de arriba (login, chat), es una red de contencion general para
// que ninguna cuenta -sea por script, error de cliente o mal uso- pueda
// saturar el servidor a fuerza de pedidos. El limite es generoso a proposito:
// el uso normal (polling de chat cada 4s + no-leidos cada 15s, mas la
// navegacion habitual) queda comodo muy por debajo.
export const apiRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Demasiadas solicitudes. Esperá unos minutos e intentá nuevamente.' },
});
