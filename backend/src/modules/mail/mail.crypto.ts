// CIFRADO DE LAS CONTRASENAS DE CASILLA
//
// Hasta ahora la plataforma no guardaba NADA reversible: la contrasena de una
// persona es un hash bcrypt y la sesion es un hash SHA-256. Nadie -ni con la
// base entera en la mano- puede recuperar una contrasena.
//
// Un cliente de correo no puede funcionar asi: para conectarse al IMAP tiene
// que mandar la contrasena real, o sea que necesita poder descifrarla. Eso
// cambia el perfil de riesgo y hay que asumirlo con los ojos abiertos:
//
//   - La clave de cifrado vive en el .env (MAIL_ENCRYPTION_KEY), NO en la base.
//     Quien se lleve un volcado de la base sin el .env no puede hacer nada con
//     los cifrados.
//   - Sin esa variable, el correo queda DESACTIVADO. No hay una clave por
//     defecto ni derivada de otra cosa: fallar cerrado es preferible a cifrar
//     con algo que cualquiera que lea el codigo pueda reproducir.
//   - Se usa AES-256-GCM, que ademas de cifrar autentica: si alguien edita el
//     texto cifrado en la base, el descifrado falla en vez de devolver basura.
//   - Cada cifrado lleva su propio nonce aleatorio, asi dos casillas con la
//     misma contrasena no producen el mismo texto cifrado.

import crypto from 'crypto';
import { logger } from '../../utils/logger';

const ALGORITMO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let claveCache: Buffer | null | undefined;

/**
 * Clave de 32 bytes derivada de MAIL_ENCRYPTION_KEY. Devuelve null si no esta
 * configurada, que es lo que apaga la funcion de correo.
 */
function clave(): Buffer | null {
  if (claveCache !== undefined) return claveCache;
  const bruta = process.env.MAIL_ENCRYPTION_KEY?.trim();
  if (!bruta || bruta.length < 32) {
    if (bruta) {
      logger.warn('MAIL_ENCRYPTION_KEY es demasiado corta (mínimo 32 caracteres): el correo queda desactivado.');
    }
    claveCache = null;
    return null;
  }
  // Se deriva con SHA-256 para aceptar cualquier texto largo como clave sin
  // exigir que sea exactamente de 32 bytes en hexadecimal.
  claveCache = crypto.createHash('sha256').update(bruta, 'utf8').digest();
  return claveCache;
}

/** true si la plataforma puede guardar y usar credenciales de correo. */
export function correoDisponible(): boolean {
  return clave() !== null;
}

export function cifrar(texto: string): string {
  const k = clave();
  if (!k) throw new Error('MAIL_ENCRYPTION_KEY no está configurada.');
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITMO, k, nonce);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // nonce || tag || datos, todo en base64 en una sola cadena.
  return Buffer.concat([nonce, tag, datos]).toString('base64');
}

export function descifrar(cifrado: string): string {
  const k = clave();
  if (!k) throw new Error('MAIL_ENCRYPTION_KEY no está configurada.');
  const bruto = Buffer.from(cifrado, 'base64');
  if (bruto.length <= NONCE_BYTES + TAG_BYTES) throw new Error('Credencial de correo inválida.');
  const nonce = bruto.subarray(0, NONCE_BYTES);
  const tag = bruto.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const datos = bruto.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITMO, k, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

/** Para los registros: nunca se escribe una credencial, ni siquiera cifrada. */
export function ocultar(email: string): string {
  const [usuario, dominio] = email.split('@');
  if (!dominio) return '***';
  const visible = (usuario ?? '').slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, (usuario?.length ?? 2) - 2))}@${dominio}`;
}
