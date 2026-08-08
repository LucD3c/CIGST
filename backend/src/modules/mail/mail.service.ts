import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import { ROLES } from '../../middleware/rbac.middleware';
import { logger } from '../../utils/logger';
import { sortByName } from '../../utils/sortByName';
import * as cripto from './mail.crypto';
import * as cliente from './mail.client';
import { limpiarHtmlDeCorreo, htmlATexto } from './mail.sanitize';
import { PRESETS } from './mail.presets';
import { assertDestinoPermitido, PUERTOS_IMAP, PUERTOS_SMTP } from './mail.network';
import { filePathFor } from './../attachments/attachments.storage';
import type { SessionUser } from '../auth/auth.service';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  CreateAccountInput,
  UpdateAccountInput,
  SendMessageInput,
} from './mail.schema';

const activo = { deletedAt: null } as const;

function assertDisponible() {
  if (!cripto.correoDisponible()) {
    throw HttpError.badRequest(
      'El correo está desactivado: falta configurar MAIL_ENCRYPTION_KEY en el archivo .env del servidor. ' +
        'El instalador la genera sola al actualizar; si actualizaste a mano, ejecutá el instalador y elegí la opción 1.',
    );
  }
}

function assertAdmin(user: SessionUser) {
  if (user.role !== ROLES.ADMIN) {
    throw HttpError.forbidden('Solo un Administrador puede configurar servidores de correo.');
  }
}

export function estado() {
  return { disponible: cripto.correoDisponible(), presets: PRESETS };
}

/* ---------- Proveedores (solo Administrador) ---------- */

export async function listProviders(user: SessionUser) {
  assertAdmin(user);
  const filas = await prisma.mailProvider.findMany({
    where: activo,
    orderBy: { name: 'asc' },
    include: { _count: { select: { accounts: true } } },
  });
  return filas.map((p) => ({
    id: p.id,
    name: p.name,
    imapHost: p.imapHost,
    imapPort: p.imapPort,
    imapSecure: p.imapSecure,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecurity: p.smtpSecurity,
    allowInternal: p.allowInternal,
    status: p.status,
    accountCount: p._count.accounts,
  }));
}

/** Lo que ve una persona comun: solo el nombre, para poder elegirlo. */
export async function listProvidersForUsers() {
  const filas = await prisma.mailProvider.findMany({
    where: { ...activo, status: 'Activo' },
    select: { id: true, name: true },
  });
  return sortByName(filas, (p) => p.name);
}

export async function createProvider(user: SessionUser, data: CreateProviderInput) {
  assertAdmin(user);
  assertDisponible();
  // Se comprueban los destinos ANTES de guardar: no tiene sentido dejar
  // configurado algo que no se va a poder usar.
  await assertDestinoPermitido(data.imapHost, data.imapPort, PUERTOS_IMAP, data.allowInternal, 'IMAP');
  await assertDestinoPermitido(data.smtpHost, data.smtpPort, PUERTOS_SMTP, data.allowInternal, 'SMTP');
  try {
    return await prisma.mailProvider.create({ data: { ...data, createdById: user.id } });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un proveedor con ese nombre.');
    throw err;
  }
}

export async function updateProvider(user: SessionUser, id: string, data: UpdateProviderInput) {
  assertAdmin(user);
  const existente = await prisma.mailProvider.findFirst({ where: { id, ...activo } });
  if (!existente) throw HttpError.notFound('Proveedor no encontrado.');

  const fusion = { ...existente, ...data };
  await assertDestinoPermitido(fusion.imapHost, fusion.imapPort, PUERTOS_IMAP, fusion.allowInternal, 'IMAP');
  await assertDestinoPermitido(fusion.smtpHost, fusion.smtpPort, PUERTOS_SMTP, fusion.allowInternal, 'SMTP');

  try {
    const actualizado = await prisma.mailProvider.update({ where: { id }, data });
    // Cambio el servidor: las conexiones abiertas de sus casillas ya no valen.
    const cuentas = await prisma.mailAccount.findMany({ where: { providerId: id }, select: { id: true } });
    cuentas.forEach((c) => cliente.olvidarConexion(c.id));
    return actualizado;
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un proveedor con ese nombre.');
    throw err;
  }
}

export async function removeProvider(user: SessionUser, id: string) {
  assertAdmin(user);
  const cuentas = await prisma.mailAccount.count({ where: { providerId: id, ...activo } });
  if (cuentas > 0) {
    throw HttpError.conflict(
      `No se puede eliminar: todavía hay ${cuentas} ${cuentas === 1 ? 'casilla configurada' : 'casillas configuradas'} ` +
        'con este proveedor. Eliminá o migrá esas casillas primero.',
    );
  }
  await prisma.mailProvider.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ---------- Casillas ---------- */

type CuentaConProveedor = Awaited<ReturnType<typeof buscarCuenta>>;

async function buscarCuenta(id: string) {
  const cuenta = await prisma.mailAccount.findFirst({
    where: { id, ...activo },
    include: { provider: true, access: true },
  });
  if (!cuenta) throw HttpError.notFound('Casilla no encontrada.');
  return cuenta;
}

async function sectorDe(user: SessionUser): Promise<string | null> {
  if (!user.employeeId) return null;
  const e = await prisma.employee.findFirst({ where: { id: user.employeeId, deletedAt: null }, select: { sectorId: true } });
  return e?.sectorId ?? null;
}

/**
 * Puede usar esta casilla: es suya, o es compartida y le dieron acceso (por
 * persona o por sector). Un Administrador NO lee casillas ajenas por defecto,
 * igual que no lee los chats: administra la configuracion, no el contenido.
 */
async function puedeUsar(user: SessionUser, cuenta: { ownerUserId: string | null; access: { userId: string | null; sectorId: string | null }[] }) {
  if (cuenta.ownerUserId) return cuenta.ownerUserId === user.id;
  if (cuenta.access.some((a) => a.userId === user.id)) return true;
  const sector = await sectorDe(user);
  return Boolean(sector && cuenta.access.some((a) => a.sectorId === sector));
}

async function assertPuedeUsar(user: SessionUser, id: string) {
  const cuenta = await buscarCuenta(id);
  if (!(await puedeUsar(user, cuenta))) throw HttpError.forbidden('No tenés acceso a esta casilla.');
  return cuenta;
}

function config(cuenta: NonNullable<CuentaConProveedor>): cliente.ConfigCasilla {
  return {
    cuentaId: cuenta.id,
    email: cuenta.email,
    usuario: cuenta.authUser || cuenta.email,
    password: cripto.descifrar(cuenta.secretCipher),
    imapHost: cuenta.provider.imapHost,
    imapPort: cuenta.provider.imapPort,
    imapSecure: cuenta.provider.imapSecure,
    smtpHost: cuenta.provider.smtpHost,
    smtpPort: cuenta.provider.smtpPort,
    smtpSecurity: cuenta.provider.smtpSecurity as 'ssl' | 'starttls' | 'ninguno',
    allowInternal: cuenta.provider.allowInternal,
  };
}

function serializar(c: { id: string; email: string; displayName: string | null; ownerUserId: string | null; status: string; lastError: string | null; lastCheckedAt: Date | null; provider: { id: string; name: string } }) {
  return {
    id: c.id,
    email: c.email,
    displayName: c.displayName || c.email,
    compartida: c.ownerUserId === null,
    status: c.status,
    lastError: c.lastError,
    lastCheckedAt: c.lastCheckedAt,
    provider: { id: c.provider.id, name: c.provider.name },
  };
}

/** Casillas que esta persona puede abrir: las suyas y las compartidas que le dieron. */
export async function listAccounts(user: SessionUser) {
  if (!cripto.correoDisponible()) return [];
  const sector = await sectorDe(user);
  const filas = await prisma.mailAccount.findMany({
    where: {
      ...activo,
      status: 'Activo',
      OR: [
        { ownerUserId: user.id },
        { ownerUserId: null, access: { some: { userId: user.id } } },
        ...(sector ? [{ ownerUserId: null, access: { some: { sectorId: sector } } }] : []),
      ],
    },
    include: { provider: { select: { id: true, name: true } } },
    orderBy: [{ ownerUserId: 'desc' }, { email: 'asc' }],
  });
  return filas.map(serializar);
}

/** Todas las casillas, para la pantalla de administracion. Sin credenciales. */
export async function listAllAccounts(user: SessionUser) {
  assertAdmin(user);
  const filas = await prisma.mailAccount.findMany({
    where: activo,
    include: {
      provider: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      access: { include: { user: { select: { id: true, name: true } }, sector: { select: { id: true, name: true } } } },
    },
    orderBy: { email: 'asc' },
  });
  return filas.map((c) => ({
    ...serializar(c),
    owner: c.owner,
    access: c.access.map((a) => ({ id: a.id, user: a.user, sector: a.sector })),
  }));
}

export async function createAccount(user: SessionUser, data: CreateAccountInput) {
  assertDisponible();
  if (data.shared) assertAdmin(user);

  const proveedor = await prisma.mailProvider.findFirst({ where: { id: data.providerId, ...activo } });
  if (!proveedor) throw HttpError.badRequest('Ese proveedor no existe.');

  const cfg: cliente.ConfigCasilla = {
    cuentaId: 'prueba',
    email: data.email,
    usuario: data.authUser || data.email,
    password: data.password,
    imapHost: proveedor.imapHost,
    imapPort: proveedor.imapPort,
    imapSecure: proveedor.imapSecure,
    smtpHost: proveedor.smtpHost,
    smtpPort: proveedor.smtpPort,
    smtpSecurity: proveedor.smtpSecurity as 'ssl' | 'starttls' | 'ninguno',
    allowInternal: proveedor.allowInternal,
  };
  // Se prueba ANTES de guardar: nadie deberia descubrir que la contrasena
  // estaba mal recien cuando abre la bandeja y la ve vacia.
  await cliente.probarConexion(cfg);

  const creada = await prisma.mailAccount.create({
    data: {
      providerId: data.providerId,
      ownerUserId: data.shared ? null : user.id,
      email: data.email,
      displayName: data.displayName || null,
      authUser: data.authUser || null,
      secretCipher: cripto.cifrar(data.password),
      lastCheckedAt: new Date(),
    },
    include: { provider: { select: { id: true, name: true } } },
  });
  logger.info({ casilla: cripto.ocultar(data.email), compartida: data.shared }, 'Casilla de correo agregada');
  return serializar(creada);
}

export async function updateAccount(user: SessionUser, id: string, data: UpdateAccountInput) {
  const cuenta = await buscarCuenta(id);
  // Una casilla compartida la administra un Administrador; la propia, su dueno.
  if (cuenta.ownerUserId === null) assertAdmin(user);
  else if (cuenta.ownerUserId !== user.id) throw HttpError.forbidden('Solo podés editar tus propias casillas.');

  const patch: Record<string, unknown> = {};
  if (data.displayName !== undefined) patch.displayName = data.displayName || null;
  if (data.authUser !== undefined) patch.authUser = data.authUser || null;
  if (data.status !== undefined) patch.status = data.status;
  if (data.password) {
    const cfg = { ...config(cuenta), password: data.password, usuario: (data.authUser ?? cuenta.authUser) || cuenta.email };
    await cliente.probarConexion(cfg);
    patch.secretCipher = cripto.cifrar(data.password);
    patch.lastCheckedAt = new Date();
    patch.lastError = null;
  }
  const actualizada = await prisma.mailAccount.update({
    where: { id },
    data: patch,
    include: { provider: { select: { id: true, name: true } } },
  });
  cliente.olvidarConexion(id);
  return serializar(actualizada);
}

export async function removeAccount(user: SessionUser, id: string) {
  const cuenta = await buscarCuenta(id);
  if (cuenta.ownerUserId === null) assertAdmin(user);
  else if (cuenta.ownerUserId !== user.id) throw HttpError.forbidden('Solo podés eliminar tus propias casillas.');
  cliente.olvidarConexion(id);
  await prisma.mailAccount.update({ where: { id }, data: { deletedAt: new Date() } });
}

/* ---------- Accesos a casillas compartidas (solo Administrador) ---------- */

export async function grantAccess(user: SessionUser, accountId: string, data: { userId?: string | null; sectorId?: string | null }) {
  assertAdmin(user);
  const cuenta = await buscarCuenta(accountId);
  if (cuenta.ownerUserId !== null) throw HttpError.badRequest('Solo las casillas compartidas tienen lista de acceso.');
  return prisma.mailAccountAccess.create({
    data: { accountId, userId: data.userId ?? null, sectorId: data.sectorId ?? null },
  });
}

export async function revokeAccess(user: SessionUser, accountId: string, accessId: string) {
  assertAdmin(user);
  const fila = await prisma.mailAccountAccess.findUnique({ where: { id: accessId } });
  if (!fila || fila.accountId !== accountId) throw HttpError.notFound('Ese acceso no existe.');
  await prisma.mailAccountAccess.delete({ where: { id: accessId } });
}

/* ---------- Uso ---------- */

async function registrarError(id: string, err: unknown) {
  const mensaje = err instanceof Error ? err.message : 'Error desconocido';
  await prisma.mailAccount
    .update({ where: { id }, data: { lastError: mensaje.slice(0, 400), lastCheckedAt: new Date() } })
    .catch(() => undefined);
}

async function registrarOk(id: string) {
  await prisma.mailAccount.update({ where: { id }, data: { lastError: null, lastCheckedAt: new Date() } }).catch(() => undefined);
}

export async function folders(user: SessionUser, accountId: string) {
  const cuenta = await assertPuedeUsar(user, accountId);
  try {
    const carpetas = await cliente.listarCarpetas(config(cuenta));
    await registrarOk(accountId);
    return carpetas;
  } catch (err) {
    await registrarError(accountId, err);
    throw err;
  }
}

export async function messages(user: SessionUser, accountId: string, opciones: { folder?: string; page?: number; q?: string }) {
  const cuenta = await assertPuedeUsar(user, accountId);
  const carpeta = opciones.folder || 'INBOX';
  try {
    const r = await cliente.listarMensajes(config(cuenta), carpeta, opciones.page ?? 1, opciones.q);
    await registrarOk(accountId);
    return { ...r, folder: carpeta };
  } catch (err) {
    await registrarError(accountId, err);
    throw err;
  }
}

export async function message(
  user: SessionUser,
  accountId: string,
  folder: string,
  uid: number,
  opciones: { mostrarImagenes?: boolean } = {},
) {
  const cuenta = await assertPuedeUsar(user, accountId);
  const m = await cliente.leerMensaje(config(cuenta), folder, uid);
  const limpio = m.html ? limpiarHtmlDeCorreo(m.html, opciones) : null;
  return {
    ...m,
    html: limpio?.html ?? null,
    imagenesBloqueadas: limpio?.imagenesBloqueadas ?? 0,
    texto: m.texto || (m.html ? htmlATexto(m.html) : ''),
    folder,
  };
}

export async function downloadAttachment(user: SessionUser, accountId: string, folder: string, uid: number, indice: number) {
  const cuenta = await assertPuedeUsar(user, accountId);
  return cliente.bajarAdjunto(config(cuenta), folder, uid, indice);
}

export async function setRead(user: SessionUser, accountId: string, folder: string, uid: number, leido: boolean) {
  const cuenta = await assertPuedeUsar(user, accountId);
  await cliente.marcarLeido(config(cuenta), folder, uid, leido);
}

export async function remove(user: SessionUser, accountId: string, folder: string, uid: number) {
  const cuenta = await assertPuedeUsar(user, accountId);
  return cliente.borrarMensaje(config(cuenta), folder, uid);
}

export async function send(user: SessionUser, accountId: string, data: SendMessageInput) {
  const cuenta = await assertPuedeUsar(user, accountId);

  // Los adjuntos salen del mismo sistema que el resto de la plataforma: se
  // suben antes y aca se toman por id, comprobando que sean de quien envia.
  const adjuntos: { filename: string; path: string }[] = [];
  if (data.attachmentIds.length) {
    const filas = await prisma.attachment.findMany({
      where: { id: { in: data.attachmentIds }, uploadedById: user.id },
      select: { storedName: true, originalName: true },
    });
    if (filas.length !== new Set(data.attachmentIds).size) {
      throw HttpError.badRequest('Alguno de los archivos ya no está disponible. Volvé a adjuntarlo.');
    }
    for (const f of filas) adjuntos.push({ filename: f.originalName, path: filePathFor(f.storedName) });
  }

  try {
    const r = await cliente.enviar(config(cuenta), {
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      text: data.body,
      inReplyTo: data.inReplyTo,
      references: data.references,
      attachments: adjuntos,
    });
    await registrarOk(accountId);
    logger.info({ casilla: cripto.ocultar(cuenta.email), por: user.id }, 'Correo enviado');
    return r;
  } catch (err) {
    await registrarError(accountId, err);
    throw err;
  }
}

export async function testAccount(user: SessionUser, accountId: string) {
  const cuenta = await assertPuedeUsar(user, accountId);
  try {
    const r = await cliente.probarConexion(config(cuenta));
    await registrarOk(accountId);
    return r;
  } catch (err) {
    await registrarError(accountId, err);
    throw err;
  }
}

export function diagnostico(user: SessionUser) {
  assertAdmin(user);
  return { conexionesAbiertas: cliente.conexionesAbiertas(), disponible: cripto.correoDisponible() };
}
