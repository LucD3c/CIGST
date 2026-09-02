import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';

// ---------------------------------------------------------------------------
// Freno de fuerza bruta CONTRA LA BASE DE DATOS.
//
// El limitador de express que ya existia vive en memoria del proceso: alcanzaba
// con reiniciar el contenedor para que el contador volviera a cero. Este freno
// guarda los intentos fallidos en la base, asi que sobrevive a reinicios,
// actualizaciones y caidas.
//
// Los dos frenos conviven a proposito: el de memoria es instantaneo y barato
// (corta un flood antes de tocar la base), este es el que de verdad sostiene
// el bloqueo en el tiempo.
// ---------------------------------------------------------------------------

const VENTANA_MS = 15 * 60 * 1000;

// Por cuenta: ocho errores seguidos ya no es alguien que se equivoco de tecla.
const MAX_POR_USUARIO = 8;

// Por direccion de red: mas alto a proposito, porque una oficina entera sale
// por la misma IP y no se puede castigar a todos por uno.
const MAX_POR_IP = 30;

function desde() {
  return new Date(Date.now() - VENTANA_MS);
}

function minutosRestantes(masViejo: Date): number {
  const restante = VENTANA_MS - (Date.now() - masViejo.getTime());
  return Math.max(1, Math.ceil(restante / 60000));
}

/**
 * Corta ANTES de comparar la contrasena si la cuenta o la IP ya acumularon
 * demasiados fallos recientes. Nunca revela si el usuario existe.
 */
export async function assertPuedeIntentar(username: string, ip: string) {
  const corte = desde();

  const [porUsuario, porIp] = await Promise.all([
    prisma.loginAttempt.findMany({
      where: { username, createdAt: { gte: corte } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.loginAttempt.count({ where: { ipAddress: ip, createdAt: { gte: corte } } }),
  ]);

  if (porUsuario.length >= MAX_POR_USUARIO) {
    const espera = minutosRestantes(porUsuario[0]!.createdAt);
    throw HttpError.tooManyRequests(
      `Demasiados intentos fallidos. Volvé a probar en ${espera} minuto${espera === 1 ? '' : 's'}, ` +
        'o pedile a un administrador que te restablezca la contraseña.',
    );
  }

  if (porIp >= MAX_POR_IP) {
    throw HttpError.tooManyRequests(
      'Demasiados intentos fallidos desde esta red. Esperá unos minutos e intentá nuevamente.',
    );
  }
}

/** Deja registrado un intento fallido. */
export async function registrarFallo(username: string, ip: string) {
  await prisma.loginAttempt
    .create({ data: { username: username.slice(0, 150), ipAddress: ip.slice(0, 64) } })
    .catch(() => undefined);
}

/**
 * Entro bien: se limpian los fallos de esa cuenta para que un error de tecleo
 * de ayer no le cuente en contra hoy.
 */
export async function limpiarFallos(username: string) {
  await prisma.loginAttempt.deleteMany({ where: { username } }).catch(() => undefined);
}
