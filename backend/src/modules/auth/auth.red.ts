import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Direccion de red de la maquina desde la que se esta usando la plataforma.
//
// Para que sirve: cuando alguien de recepcion llama a sistemas, lo primero que
// le preguntan es "que IP tenes". Tenerla a mano en pantalla evita explicarle
// por telefono como abrir una consola, y le permite al tecnico conectarse por
// VNC directamente.
//
// Decisiones de seguridad, en orden de importancia:
//
//   1. La direccion SALE DEL PROPIO PEDIDO. No hay ningun parametro de entrada
//      ni ningun identificador de usuario: es fisicamente imposible pedir la
//      direccion de otra persona, porque no hay forma de nombrarla.
//   2. Requiere sesion iniciada. Nadie sin autenticar obtiene nada.
//   3. En la interfaz esta OCULTA por defecto, detras de un boton de mostrar.
//      Una IP interna es informacion de infraestructura y no tiene por que
//      quedar expuesta en pantalla mientras alguien comparte su escritorio o
//      alguien pasa por detras.
//   4. No se guarda ni se registra en ningun lado a partir de esta consulta.
// ---------------------------------------------------------------------------

const RANGOS_PRIVADOS: ((p: number[]) => boolean)[] = [
  (p) => p[0] === 10,
  (p) => p[0] === 172 && p[1]! >= 16 && p[1]! <= 31,
  (p) => p[0] === 192 && p[1] === 168,
  (p) => p[0] === 169 && p[1] === 254, // enlace local
  (p) => p[0] === 127, // bucle local
];

export interface InfoRed {
  ip: string | null;
  esPrivada: boolean;
  version: 'IPv4' | 'IPv6' | null;
}

/**
 * Normaliza lo que informa Express. Node entrega las direcciones IPv4 en forma
 * "mapeada" cuando el socket es IPv6 (::ffff:192.168.1.40): se devuelve la
 * forma corta, que es la que la persona necesita leerle al tecnico.
 */
export function direccionDe(req: Request): InfoRed {
  const bruta = req.ip;
  if (!bruta) return { ip: null, esPrivada: false, version: null };

  let ip = bruta.trim();

  // IPv4 mapeada dentro de IPv6.
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapeada) ip = mapeada[1]!;

  // El bucle local IPv6 se muestra en su equivalente IPv4, mas reconocible.
  if (ip === '::1') ip = '127.0.0.1';

  const partes = ip.split('.');
  const esIPv4 = partes.length === 4 && partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);

  if (esIPv4) {
    const nums = partes.map(Number);
    return { ip, esPrivada: RANGOS_PRIVADOS.some((f) => f(nums)), version: 'IPv4' };
  }

  // IPv6: se considera "privada" el bucle local, el enlace local (fe80::/10) y
  // las direcciones unicas locales (fc00::/7).
  const bajo = ip.toLowerCase();
  const privadaV6 = bajo === '::1' || bajo.startsWith('fe80:') || bajo.startsWith('fc') || bajo.startsWith('fd');
  return { ip, esPrivada: privadaV6, version: 'IPv6' };
}
