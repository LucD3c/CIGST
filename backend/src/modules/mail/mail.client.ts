// CLIENTE IMAP / SMTP
//
// Todas las conexiones son SALIENTES: la plataforma se conecta al proveedor
// como lo haria Outlook desde la misma PC. No abre ningun puerto, no recibe
// correo de afuera y no hace falta tocar el firewall de entrada.
//
// Nada del contenido de los correos se guarda en la base. Se pide al proveedor
// lo que hace falta para mostrar la pantalla y se descarta. Eso evita duplicar
// datos sensibles (en un centro medico, el correo tiene datos de pacientes) y
// hace que el disco no crezca por tener la plataforma abierta.

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { logger } from '../../utils/logger';
import { HttpError } from '../../utils/httpError';
import { assertDestinoPermitido, PUERTOS_IMAP, PUERTOS_SMTP } from './mail.network';
import { ocultar } from './mail.crypto';

export type ConfigCasilla = {
  cuentaId: string;
  email: string;
  usuario: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'ssl' | 'starttls' | 'ninguno';
  allowInternal: boolean;
};

/* ---------- Reserva de conexiones ---------- */
// Abrir una conexion IMAP cuesta entre medio segundo y un segundo (saludo TLS
// + autenticacion). Hacerlo en cada clic haria que la bandeja se sienta
// pesada. Se guarda la conexion abierta un rato y se reusa; si nadie la toca,
// se cierra sola. Hay un tope de conexiones para que la memoria no crezca sin
// limite si mucha gente abre el correo a la vez.

const OCIO_MS = 90_000;
const MAX_ABIERTAS = 30;

type Reservada = { cliente: ImapFlow; ultimoUso: number; enUso: boolean };
const reserva = new Map<string, Reservada>();

setInterval(() => {
  const ahora = Date.now();
  for (const [clave, r] of reserva) {
    if (r.enUso || ahora - r.ultimoUso < OCIO_MS) continue;
    reserva.delete(clave);
    r.cliente.logout().catch(() => r.cliente.close());
  }
}, 30_000).unref?.();

/**
 * Traduce los errores del proveedor a algo que una persona pueda accionar.
 *
 * Los servidores de correo son parcos: Gmail contesta literalmente
 * "Command failed" cuando la contrasena esta mal. El detalle util viene en
 * otros campos del error (responseText, serverResponseCode, code) y en las
 * banderas que pone la libreria, asi que se miran todos antes de rendirse.
 */
function traducirError(err: unknown, donde: string): HttpError {
  const e = err as {
    message?: string;
    responseText?: string;
    serverResponseCode?: string;
    code?: string;
    authenticationFailed?: boolean;
    response?: string;
  } | undefined;

  // La libreria marca explicitamente el fallo de autenticacion: es la senal
  // mas confiable, mas que cualquier texto.
  if (e?.authenticationFailed) return errorDeCredenciales();

  const msg = [e?.message, e?.responseText, e?.response, e?.serverResponseCode, e?.code]
    .filter(Boolean)
    .join(' | ');
  const bajo = msg.toLowerCase();

  if (bajo.includes('authenticationfailed') || bajo.includes('login failed') || bajo.includes('[authenticationfailed]')) {
    return errorDeCredenciales();
  }

  if (bajo.includes('invalid credentials') || bajo.includes('authentication failed') || (bajo.includes('auth') && bajo.includes('fail'))) {
    return errorDeCredenciales();
  }
  if (bajo.includes('enotfound') || bajo.includes('getaddrinfo')) {
    return HttpError.badRequest('No se encontró el servidor de correo. Revisá el nombre en la configuración del proveedor.');
  }
  if (bajo.includes('econnrefused')) {
    return HttpError.badRequest('El servidor rechazó la conexión. Suele ser el puerto equivocado.');
  }
  if (bajo.includes('etimedout') || bajo.includes('timeout')) {
    return HttpError.badRequest(
      'El servidor no respondió a tiempo. Puede ser que la red de la empresa no deje salir a ese puerto: ' +
        'consultalo con Infraestructura.',
    );
  }
  if (bajo.includes('certificate') || bajo.includes('self signed') || bajo.includes('altnames')) {
    return HttpError.badRequest('El certificado del servidor no es válido para ese nombre. Revisá el nombre del servidor.');
  }
  if (bajo.includes('disabled') || bajo.includes('not enabled') || bajo.includes('basic authentication')) {
    return HttpError.badRequest(
      'El proveedor tiene deshabilitado el acceso por IMAP/SMTP para esta casilla. ' +
        'Quien administre el correo de la empresa tiene que habilitarlo.',
    );
  }
  // Ultimo recurso. Cuando el fallo ocurre AL CONECTAR o AL PROBAR, en la
  // practica casi siempre es la contrasena: el host y el puerto ya se
  // validaron antes de llegar hasta aca. Decirlo es mucho mas util que un
  // "no se pudo completar la operacion" que no le sirve a nadie.
  logger.warn({ err, donde, detalle: msg.slice(0, 300) }, 'Error de correo sin traduccion especifica');
  if (donde === 'conexión' || donde === 'IMAP' || donde === 'SMTP') return errorDeCredenciales();
  return HttpError.badRequest(
    `El servidor de correo rechazó la operación y no explicó por qué. ` +
      `Suele ser la contraseña o un permiso que el proveedor tiene deshabilitado para esta casilla.`,
  );
}

function errorDeCredenciales(): HttpError {
  return HttpError.badRequest(
    'El servidor de correo rechazó el usuario o la contraseña. Tres causas habituales: ' +
      '(1) en Gmail y Yahoo hace falta una «contraseña de aplicación», no la contraseña normal de la cuenta; ' +
      '(2) en Microsoft 365, quien administre el correo tiene que habilitar el acceso IMAP/SMTP para esa casilla; ' +
      '(3) el usuario de acceso no es la dirección completa (probá con solo la parte de antes del @, o al revés).',
  );
}

async function conectar(cfg: ConfigCasilla): Promise<ImapFlow> {
  // Se revalida el destino en CADA conexion, no solo al guardar: entre una
  // cosa y la otra el nombre puede haber cambiado a donde apunta.
  await assertDestinoPermitido(cfg.imapHost, cfg.imapPort, PUERTOS_IMAP, cfg.allowInternal, 'IMAP');

  const cliente = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.usuario, pass: cfg.password },
    logger: false,
    // Sin esto, una casilla mal configurada deja el pedido colgado y la
    // pantalla girando para siempre.
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  });
  await cliente.connect();
  return cliente;
}

/** Ejecuta algo con una conexion IMAP lista, reusandola si ya estaba abierta. */
export async function conImap<T>(cfg: ConfigCasilla, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const clave = cfg.cuentaId;
  let r = reserva.get(clave);

  if (r && (r.enUso || !r.cliente.usable)) {
    if (!r.cliente.usable) reserva.delete(clave);
    r = undefined;
  }

  if (!r) {
    if (reserva.size >= MAX_ABIERTAS) {
      // Se cierra la mas vieja que no este en uso.
      const libre = [...reserva.entries()].filter(([, x]) => !x.enUso).sort((a, b) => a[1].ultimoUso - b[1].ultimoUso)[0];
      if (libre) {
        reserva.delete(libre[0]);
        libre[1].cliente.logout().catch(() => libre[1].cliente.close());
      }
    }
    let cliente: ImapFlow;
    try {
      cliente = await conectar(cfg);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw traducirError(err, 'conexión');
    }
    r = { cliente, ultimoUso: Date.now(), enUso: false };
    reserva.set(clave, r);
    logger.info({ casilla: ocultar(cfg.email), abiertas: reserva.size }, 'Conexión de correo abierta');
  }

  r.enUso = true;
  try {
    return await fn(r.cliente);
  } catch (err) {
    // Una conexion que fallo no se reusa: se descarta para que el proximo
    // intento arranque limpio.
    reserva.delete(clave);
    r.cliente.close();
    if (err instanceof HttpError) throw err;
    throw traducirError(err, 'operación');
  } finally {
    r.enUso = false;
    r.ultimoUso = Date.now();
  }
}

/** Cierra y olvida la conexion de una casilla (al editarla o darla de baja). */
export function olvidarConexion(cuentaId: string) {
  const r = reserva.get(cuentaId);
  if (!r) return;
  reserva.delete(cuentaId);
  r.cliente.logout().catch(() => r.cliente.close());
}

export function conexionesAbiertas() {
  return reserva.size;
}

/* ---------- Operaciones ---------- */

export type Carpeta = { path: string; nombre: string; especial: string | null; sinLeer: number; total: number };

const ESPECIALES: Record<string, string> = {
  '\\Inbox': 'entrada',
  '\\Sent': 'enviados',
  '\\Drafts': 'borradores',
  '\\Trash': 'papelera',
  '\\Junk': 'spam',
  '\\Archive': 'archivo',
};

export async function listarCarpetas(cfg: ConfigCasilla): Promise<Carpeta[]> {
  return conImap(cfg, async (c) => {
    const lista = await c.list();
    const salida: Carpeta[] = [];
    for (const f of lista) {
      if (f.flags?.has('\\Noselect')) continue;
      let especial: string | null = null;
      for (const [bandera, nombre] of Object.entries(ESPECIALES)) {
        if (f.specialUse === bandera || (bandera === '\\Inbox' && f.path.toUpperCase() === 'INBOX')) especial = nombre;
      }
      const estado = await c.status(f.path, { messages: true, unseen: true }).catch(() => null);
      salida.push({
        path: f.path,
        nombre: f.name || f.path,
        especial,
        sinLeer: estado?.unseen ?? 0,
        total: estado?.messages ?? 0,
      });
    }
    // La bandeja de entrada primero, despues las especiales conocidas y al
    // final el resto por nombre.
    const orden = ['entrada', 'enviados', 'borradores', 'archivo', 'spam', 'papelera'];
    return salida.sort((a, b) => {
      const ia = a.especial ? orden.indexOf(a.especial) : 99;
      const ib = b.especial ? orden.indexOf(b.especial) : 99;
      if (ia !== ib) return ia - ib;
      return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
    });
  });
}

export type Resumen = {
  uid: number;
  asunto: string;
  de: string;
  deNombre: string;
  para: string;
  fecha: string | null;
  leido: boolean;
  respondido: boolean;
  tieneAdjuntos: boolean;
  tamano: number;
};

const POR_PAGINA = 25;

function direccionTexto(dir: unknown): { texto: string; nombre: string } {
  const d = dir as { value?: { address?: string; name?: string }[] } | undefined;
  const primero = d?.value?.[0];
  return { texto: primero?.address ?? '', nombre: primero?.name || primero?.address || '' };
}

export async function listarMensajes(
  cfg: ConfigCasilla,
  carpeta: string,
  pagina: number,
  busqueda?: string,
): Promise<{ mensajes: Resumen[]; total: number; pagina: number; porPagina: number }> {
  return conImap(cfg, async (c) => {
    const lock = await c.getMailboxLock(carpeta);
    try {
      const buzon = c.mailbox as { exists: number } | boolean;
      const existen = typeof buzon === 'object' ? buzon.exists : 0;

      // Con busqueda se le pide al servidor que filtre (mucho mas rapido que
      // traerse todo y filtrar aca).
      let uids: number[];
      if (busqueda) {
        uids = await c.search({ or: [{ subject: busqueda }, { from: busqueda }, { body: busqueda }] }, { uid: true }) || [];
      } else {
        uids = existen ? await c.search({ all: true }, { uid: true }) || [] : [];
      }
      const total = uids.length;
      // Mas nuevos primero.
      const ordenados = [...uids].sort((a, b) => b - a);
      const desde = (pagina - 1) * POR_PAGINA;
      const pagina_uids = ordenados.slice(desde, desde + POR_PAGINA);
      if (!pagina_uids.length) return { mensajes: [], total, pagina, porPagina: POR_PAGINA };

      const mensajes: Resumen[] = [];
      for await (const m of c.fetch(pagina_uids, { uid: true, envelope: true, flags: true, size: true, bodyStructure: true }, { uid: true })) {
        const de = m.envelope?.from?.[0];
        const para = m.envelope?.to?.[0];
        const estructura = JSON.stringify(m.bodyStructure ?? {});
        mensajes.push({
          uid: m.uid,
          asunto: m.envelope?.subject || '(sin asunto)',
          de: de?.address ?? '',
          deNombre: de?.name || de?.address || '',
          para: para?.address ?? '',
          fecha: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
          leido: m.flags?.has('\\Seen') ?? false,
          respondido: m.flags?.has('\\Answered') ?? false,
          // Heuristica barata: si la estructura menciona una disposicion de
          // adjunto, es que trae alguno. Evita bajar el cuerpo solo para saberlo.
          tieneAdjuntos: /"disposition":"attachment"/i.test(estructura),
          tamano: m.size ?? 0,
        });
      }
      mensajes.sort((a, b) => b.uid - a.uid);
      return { mensajes, total, pagina, porPagina: POR_PAGINA };
    } finally {
      lock.release();
    }
  });
}

export type MensajeCompleto = {
  uid: number;
  asunto: string;
  de: { texto: string; nombre: string };
  para: string;
  cc: string;
  fecha: string | null;
  texto: string;
  html: string | null;
  messageId: string | null;
  references: string | null;
  adjuntos: { indice: number; nombre: string; tipo: string; tamano: number }[];
};

export async function leerMensaje(cfg: ConfigCasilla, carpeta: string, uid: number): Promise<MensajeCompleto> {
  return conImap(cfg, async (c) => {
    const lock = await c.getMailboxLock(carpeta);
    try {
      const bajado = await c.download(String(uid), undefined, { uid: true });
      if (!bajado?.content) throw HttpError.notFound('Ese correo ya no está en el servidor.');
      const parseado = await simpleParser(bajado.content);

      // Al abrirlo se marca como leido, que es lo que espera cualquiera.
      await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => undefined);

      return {
        uid,
        asunto: parseado.subject || '(sin asunto)',
        de: direccionTexto(parseado.from),
        para: (parseado.to as { text?: string } | undefined)?.text ?? '',
        cc: (parseado.cc as { text?: string } | undefined)?.text ?? '',
        fecha: parseado.date ? parseado.date.toISOString() : null,
        texto: parseado.text ?? '',
        html: typeof parseado.html === 'string' ? parseado.html : null,
        messageId: parseado.messageId ?? null,
        references: Array.isArray(parseado.references) ? parseado.references.join(' ') : parseado.references ?? null,
        adjuntos: (parseado.attachments ?? []).map((a, i) => ({
          indice: i,
          nombre: a.filename || `adjunto-${i + 1}`,
          tipo: a.contentType || 'application/octet-stream',
          tamano: a.size ?? 0,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function bajarAdjunto(
  cfg: ConfigCasilla,
  carpeta: string,
  uid: number,
  indice: number,
): Promise<{ nombre: string; tipo: string; contenido: Buffer }> {
  return conImap(cfg, async (c) => {
    const lock = await c.getMailboxLock(carpeta);
    try {
      const bajado = await c.download(String(uid), undefined, { uid: true });
      if (!bajado?.content) throw HttpError.notFound('Ese correo ya no está en el servidor.');
      const parseado = await simpleParser(bajado.content);
      const adj = parseado.attachments?.[indice];
      if (!adj) throw HttpError.notFound('Ese adjunto no existe en el correo.');
      return {
        nombre: adj.filename || `adjunto-${indice + 1}`,
        tipo: adj.contentType || 'application/octet-stream',
        contenido: adj.content as Buffer,
      };
    } finally {
      lock.release();
    }
  });
}

export async function marcarLeido(cfg: ConfigCasilla, carpeta: string, uid: number, leido: boolean) {
  return conImap(cfg, async (c) => {
    const lock = await c.getMailboxLock(carpeta);
    try {
      if (leido) await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      else await c.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  });
}

/**
 * Borrar = mover a la papelera, como hace cualquier cliente de correo. Si no
 * hay papelera (o ya estamos en ella) se marca como borrado de verdad.
 */
export async function borrarMensaje(cfg: ConfigCasilla, carpeta: string, uid: number) {
  return conImap(cfg, async (c) => {
    const lista = await c.list();
    const papelera = lista.find((f) => f.specialUse === '\\Trash');
    const enPapelera = papelera && papelera.path === carpeta;

    const lock = await c.getMailboxLock(carpeta);
    try {
      if (papelera && !enPapelera) {
        await c.messageMove(String(uid), papelera.path, { uid: true });
        return { movidoA: papelera.path };
      }
      await c.messageDelete(String(uid), { uid: true });
      return { movidoA: null };
    } finally {
      lock.release();
    }
  });
}

/* ---------- Envio ---------- */

export async function enviar(
  cfg: ConfigCasilla,
  mensaje: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string;
    attachments?: { filename: string; path: string }[];
  },
) {
  await assertDestinoPermitido(cfg.smtpHost, cfg.smtpPort, PUERTOS_SMTP, cfg.allowInternal, 'SMTP');

  const transporte = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecurity === 'ssl',
    requireTLS: cfg.smtpSecurity === 'starttls',
    auth: { user: cfg.usuario, pass: cfg.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    const info = await transporte.sendMail({
      from: cfg.email,
      to: mensaje.to,
      cc: mensaje.cc || undefined,
      bcc: mensaje.bcc || undefined,
      subject: mensaje.subject,
      text: mensaje.text,
      inReplyTo: mensaje.inReplyTo,
      references: mensaje.references,
      attachments: mensaje.attachments,
    });
    return { messageId: info.messageId as string };
  } catch (err) {
    throw traducirError(err, 'envío');
  } finally {
    transporte.close();
  }
}

/** Prueba la configuracion sin guardar nada: sirve para el boton "Probar". */
export async function probarConexion(cfg: ConfigCasilla): Promise<{ imap: boolean; smtp: boolean; carpetas: number }> {
  let carpetas = 0;
  await assertDestinoPermitido(cfg.imapHost, cfg.imapPort, PUERTOS_IMAP, cfg.allowInternal, 'IMAP');
  let cliente: ImapFlow | null = null;
  try {
    cliente = await conectar(cfg);
    carpetas = (await cliente.list()).length;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw traducirError(err, 'IMAP');
  } finally {
    if (cliente) await cliente.logout().catch(() => cliente?.close());
  }

  await assertDestinoPermitido(cfg.smtpHost, cfg.smtpPort, PUERTOS_SMTP, cfg.allowInternal, 'SMTP');
  const transporte = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecurity === 'ssl',
    requireTLS: cfg.smtpSecurity === 'starttls',
    auth: { user: cfg.usuario, pass: cfg.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
  try {
    await transporte.verify();
  } catch (err) {
    throw traducirError(err, 'SMTP');
  } finally {
    transporte.close();
  }

  return { imap: true, smtp: true, carpetas };
}
