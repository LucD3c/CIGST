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
import { HttpError } from '../../utils/httpError';

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

// Se lanza cuando hay credenciales guardadas que ya no se pueden descifrar.
// El caso tipico y perfectamente esperable: se restaura una copia de seguridad
// en una instalacion nueva, donde el instalador genero una MAIL_ENCRYPTION_KEY
// distinta a la de origen. Antes eso salia como un 500 mudo y no habia forma de
// entender que estaba pasando.
export class ClaveDeCorreoInvalida extends HttpError {
  constructor() {
    super(
      409,
      'No se pueden leer las credenciales de correo guardadas: la clave de cifrado (MAIL_ENCRYPTION_KEY) ' +
        'no es la misma con la que se guardaron. Suele pasar al restaurar una copia de seguridad en una ' +
        'instalación nueva. Solución: copiá el valor de MAIL_ENCRYPTION_KEY del archivo .env original, o ' +
        'volvé a cargar la contraseña de cada casilla desde Correo → Servidores.',
    );
    this.name = 'ClaveDeCorreoInvalida';
  }
}

export function descifrar(cifrado: string): string {
  const k = clave();
  if (!k) throw new Error('MAIL_ENCRYPTION_KEY no está configurada.');
  const bruto = Buffer.from(cifrado, 'base64');
  if (bruto.length <= NONCE_BYTES + TAG_BYTES) throw new ClaveDeCorreoInvalida();
  const nonce = bruto.subarray(0, NONCE_BYTES);
  const tag = bruto.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const datos = bruto.subarray(NONCE_BYTES + TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv(ALGORITMO, k, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
  } catch {
    // AES-GCM autentica: si la clave no es la correcta, el descifrado falla
    // aca en vez de devolver basura. Se traduce a un error explicativo.
    throw new ClaveDeCorreoInvalida();
  }
}

/** Para los registros: nunca se escribe una credencial, ni siquiera cifrada. */
export function ocultar(email: string): string {
  const [usuario, dominio] = email.split('@');
  if (!dominio) return '***';
  const visible = (usuario ?? '').slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, (usuario?.length ?? 2) - 2))}@${dominio}`;
}
