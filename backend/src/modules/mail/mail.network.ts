// A DONDE SE LE PERMITE CONECTARSE AL SERVIDOR
//
// Configurar un servidor de correo es, tecnicamente, decirle al backend "abri
// una conexion a este host y este puerto". Si eso no se acota, alguien con
// acceso de Administrador -o alguien que le robe la sesion a un Administrador-
// puede apuntarlo a cualquier cosa que la plataforma alcance desde adentro de
// la red y usarla como sonda: routers, camaras, la impresora, otro servidor.
// Es lo que se conoce como SSRF, y es el riesgo real de una funcion como esta.
//
// Por eso:
//   - Se resuelve el nombre ANTES de conectar y se miran las direcciones que
//     devuelve. No alcanza con revisar el texto: "correo.empresa.com" puede
//     resolver a 127.0.0.1 igual.
//   - Las direcciones privadas, de loopback y de enlace local se rechazan,
//     salvo que un Administrador haya marcado explicitamente que ESE servidor
//     esta en la red interna (algunas empresas tienen su Exchange adentro).
//   - Los puertos se limitan a los de correo. No se puede apuntar al 22 ni al
//     3306 "a ver que contesta".
//
// La verificacion se hace al guardar la configuracion Y otra vez antes de cada
// conexion: entre una cosa y la otra, un nombre de dominio puede cambiar a
// donde apunta.

import dns from 'dns/promises';
import net from 'net';
import { HttpError } from '../../utils/httpError';

// Puertos de correo estandar. Se deja tambien 2525, que usan varios
// proveedores cuando el 587 esta bloqueado por el ISP.
export const PUERTOS_IMAP = [143, 993];
export const PUERTOS_SMTP = [25, 465, 587, 2525];

function esPrivada(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    if (a === 10) return true;                      // 10.0.0.0/8
    if (a === 127) return true;                     // loopback
    if (a === 0) return true;                       // "esta red"
    if (a === 169 && b === 254) return true;        // enlace local (incluye metadatos de nube)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;        // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                      // multicast y reservadas
    return false;
  }
  const bajo = ip.toLowerCase();
  if (bajo === '::' || bajo === '::1') return true;               // loopback
  if (bajo.startsWith('fe80')) return true;                        // enlace local
  if (bajo.startsWith('fc') || bajo.startsWith('fd')) return true;  // unicas locales
  if (bajo.startsWith('::ffff:')) return esPrivada(bajo.slice(7));  // IPv4 mapeada
  return false;
}

export type ChequeoRed = { direcciones: string[]; internas: string[] };

/**
 * Resuelve el host y devuelve sus direcciones, separando las que caen en
 * rangos internos. Lanza si el nombre no resuelve: mejor un error claro al
 * guardar que una bandeja en blanco despues.
 */
export async function resolverHost(host: string): Promise<ChequeoRed> {
  const limpio = host.trim().toLowerCase();
  if (!limpio) throw HttpError.badRequest('Falta el servidor.');

  // Si ya es una direccion, no hay nada que resolver.
  if (net.isIP(limpio)) {
    return { direcciones: [limpio], internas: esPrivada(limpio) ? [limpio] : [] };
  }

  let direcciones: string[];
  try {
    const registros = await dns.lookup(limpio, { all: true, verbatim: true });
    direcciones = registros.map((r) => r.address);
  } catch {
    throw HttpError.badRequest(
      `No se pudo resolver «${host}». Revisá que esté bien escrito y que el servidor tenga acceso a ese nombre.`,
    );
  }
  if (!direcciones.length) throw HttpError.badRequest(`«${host}» no devolvió ninguna dirección.`);

  return { direcciones, internas: direcciones.filter(esPrivada) };
}

/**
 * Valida un destino completo antes de permitir la conexion.
 * `permitirInterna` es la casilla que marca a mano un Administrador cuando el
 * servidor de correo vive en la red de la empresa.
 */
export async function assertDestinoPermitido(
  host: string,
  puerto: number,
  permitidos: number[],
  permitirInterna: boolean,
  etiqueta: string,
): Promise<void> {
  if (!permitidos.includes(puerto)) {
    throw HttpError.badRequest(
      `El puerto ${puerto} no es un puerto de ${etiqueta}. Los válidos son: ${permitidos.join(', ')}.`,
    );
  }
  const { internas, direcciones } = await resolverHost(host);
  if (internas.length && !permitirInterna) {
    throw HttpError.badRequest(
      `«${host}» apunta a una dirección de la red interna (${internas[0]}). ` +
        'Si el servidor de correo está dentro de la empresa, marcá la casilla «El servidor está en la red interna» ' +
        'al configurar el proveedor. Si no lo está, revisá el nombre del servidor.',
    );
  }
  if (!direcciones.length) {
    throw HttpError.badRequest(`No se pudo determinar la dirección de «${host}».`);
  }
}
