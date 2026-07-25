import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// El cookie del navegador guarda el token en texto plano; en base solo se persiste
// su hash SHA-256. Asi, si alguien llegara a leer la tabla de sesiones, no obtiene
// tokens utilizables (equivalente a como se tratan las contrasenas).
const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeCompareHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
