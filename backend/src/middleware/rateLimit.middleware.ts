import rateLimit from 'express-rate-limit';

// Limita intentos de login por IP: suficiente para frenar fuerza bruta basica
// sin molestar a un uso normal (alguien que erra la contrasena un par de veces).
export const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Esperá unos minutos e intentá nuevamente.' },
});
