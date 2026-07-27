import { randomBytes, createHash } from 'node:crypto';

// El cookie del navegador guarda el token en texto plano; en base solo se persiste
// su hash SHA-256. Asi, si alguien llegara a leer la tabla de sesiones, no obtiene
// tokens utilizables (equivalente a como se tratan las contrasenas).
// Token de 32 bytes (256 bits) al azar: 2^256 combinaciones posibles, muy por
// encima de lo que cualquier ataque de fuerza bruta pueda recorrer.
const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
