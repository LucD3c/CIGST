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
