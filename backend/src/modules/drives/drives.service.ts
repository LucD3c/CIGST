import type { Readable } from 'node:stream';
import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';
import { ROLES } from '../../middleware/rbac.middleware';
import { logger } from '../../utils/logger';
import { sortByName } from '../../utils/sortByName';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import * as cripto from '../mail/mail.crypto';
import * as smb from './drives.smb';
import type { SessionUser } from '../auth/auth.service';
import type { CreateDriveInput, UpdateDriveInput } from './drives.schema';

// Las contrasenas de las unidades se cifran con la MISMA clave que las de las
// casillas de correo (MAIL_ENCRYPTION_KEY, en el .env). No se agrega una
// variable nueva: una instalacion que ya tiene correo no necesita tocar nada,
// y el instalador ya sabe generarla y respaldarla.

const activa = { deletedAt: null } as const;

function assertDisponible() {
  if (!cripto.correoDisponible()) {
    throw HttpError.badRequest(
      'Las unidades de red están desactivadas: falta configurar MAIL_ENCRYPTION_KEY en el archivo .env del servidor ' +
        '(es la clave con la que se cifran las contraseñas). El instalador la genera sola: ejecutalo y elegí la opción 1.',
    );
  }
}

function assertAdmin(user: SessionUser) {
  if (user.role !== ROLES.ADMIN) throw HttpError.forbidden('Solo un Administrador puede configurar unidades de red.');
}

export function estado() {
  return { disponible: cripto.correoDisponible() };
}

/* ---------- Conexion ---------- */

type Unidad = NonNullable<Awaited<ReturnType<typeof buscar>>>;

async function buscar(id: string) {
  const unidad = await prisma.networkDrive.findFirst({ where: { id, ...activa }, include: { access: true } });
  if (!unidad) throw HttpError.notFound('Unidad de red no encontrada.');
  return unidad;
}

function descifrar(cipher: string): string {
  try {
    return cripto.descifrar(cipher);
  } catch {
    throw new HttpError(
      409,
      'No se puede leer la contraseña guardada de esta unidad: la clave de cifrado del servidor (MAIL_ENCRYPTION_KEY) ' +
        'no es la misma con la que se guardó. Suele pasar al restaurar una copia de seguridad en una instalación nueva. ' +
        'Un Administrador tiene que volver a cargar la contraseña de la unidad.',
    );
  }
}

function conexion(u: { host: string; share: string; basePath: string; domain: string | null; authUser: string; secretCipher: string }, password?: string): smb.ConexionSmb {
  return {
    host: u.host,
    share: u.share,
    base: u.basePath ? u.basePath.split('/') : [],
    domain: u.domain,
    usuario: u.authUser,
    password: password ?? descifrar(u.secretCipher),
  };
}

export function rutaUnc(u: { host: string; share: string; basePath: string }): string {
  return `\\\\${u.host}\\${u.share}${u.basePath ? `\\${u.basePath.split('/').join('\\')}` : ''}`;
}

// Se anota el resultado de la ultima conexion, para poder mostrar "la
// contrasena de esta unidad dejo de funcionar" en vez de una carpeta vacia.
// Solo cuentan las fallas de conexion o de credenciales: un archivo que no
// existe no dice nada sobre el estado de la unidad.
async function anotarFalla(id: string, err: unknown) {
  if (!(err instanceof smb.ErrorSmb) || err.tipo === 'operacion') return;
  await prisma.networkDrive
    .update({ where: { id }, data: { lastError: err.message.slice(0, 400), lastCheckedAt: new Date() } })
    .catch(() => undefined);
}

async function anotarOk(u: { id: string; lastError: string | null }) {
  if (u.lastError === null) return; // nada que limpiar: se evita una escritura por cada carpeta abierta
  await prisma.networkDrive
    .update({ where: { id: u.id }, data: { lastError: null, lastCheckedAt: new Date() } })
    .catch(() => undefined);
}

async function conAnotacion<T>(u: Unidad, accion: () => Promise<T>): Promise<T> {
  try {
    const r = await accion();
    await anotarOk(u);
    return r;
  } catch (err) {
    await anotarFalla(u.id, err);
    throw err;
  }
}

/* ---------- Permisos ---------- */

async function sectorDe(user: SessionUser): Promise<string | null> {
  if (!user.employeeId) return null;
  const e = await prisma.employee.findFirst({ where: { id: user.employeeId, deletedAt: null }, select: { sectorId: true } });
  return e?.sectorId ?? null;
}

/**
 * Puede usar la unidad quien figura en su lista de acceso, por persona o por
 * sector. Un Administrador NO ve el contenido de unidades ajenas por el solo
 * hecho de serlo: administra la configuracion, no los archivos (igual que con
 * el chat y el correo). Si necesita usarla, se la asigna a si mismo.
 */
async function assertPuedeUsar(user: SessionUser, id: string): Promise<Unidad> {
  assertDisponible();
  const u = await buscar(id);
  if (u.status !== 'Activo') throw HttpError.forbidden('Esta unidad de red está desactivada.');
  if (u.access.some((a) => a.userId === user.id)) return u;
  const sector = await sectorDe(user);
  if (sector && u.access.some((a) => a.sectorId === sector)) return u;
  throw HttpError.forbidden('No tenés acceso a esta unidad de red.');
}

/* ---------- Uso ---------- */

/** Las unidades que esta persona tiene asignadas. Sin credenciales. */
export async function listarMias(user: SessionUser) {
  if (!cripto.correoDisponible()) return [];
  const sector = await sectorDe(user);
  const filas = await prisma.networkDrive.findMany({
    where: {
      ...activa,
      status: 'Activo',
      access: { some: { OR: [{ userId: user.id }, ...(sector ? [{ sectorId: sector }] : [])] } },
    },
    include: { _count: { select: { access: true } } },
  });
  return sortByName(filas, (u) => u.name).map((u) => ({
    id: u.id,
    name: u.name,
    ruta: rutaUnc(u),
    // Se muestra al pedir la contrasena para eliminar: la persona tiene que
    // saber de que usuario es la contrasena que le piden.
    authUser: u.domain ? `${u.domain}\\${u.authUser}` : u.authUser,
    lastError: u.lastError,
  }));
}

export async function listarCarpeta(user: SessionUser, id: string, ruta: string) {
  const u = await assertPuedeUsar(user, id);
  const carpeta = smb.partirRuta(ruta);
  const entradas = await conAnotacion(u, () => smb.listar(conexion(u), carpeta));
  return { path: carpeta.join('/'), entradas };
}

export async function existe(user: SessionUser, id: string, ruta: string, nombre: string) {
  const u = await assertPuedeUsar(user, id);
  const carpeta = smb.partirRuta(ruta);
  smb.validarNombre(nombre, 'El nombre del archivo');
  const encontrada = await conAnotacion(u, () => smb.info(conexion(u), [...carpeta, nombre]));
  return { existe: encontrada !== null, tipo: encontrada?.tipo ?? null };
}

export async function abrirDescarga(user: SessionUser, id: string, ruta: string) {
  const u = await assertPuedeUsar(user, id);
  const partes = smb.partirRuta(ruta);
  if (!partes.length) throw HttpError.badRequest('Elegí un archivo.');
  const c = conexion(u);
  const datos = await conAnotacion(u, () => smb.info(c, partes));
  if (!datos) throw HttpError.notFound('El archivo ya no existe en la unidad.');
  if (datos.tipo === 'carpeta') throw HttpError.badRequest('Las carpetas no se pueden descargar enteras: abrila y descargá los archivos.');
  const descarga = await smb.descargar(c, partes);
  return { ...descarga, nombre: partes[partes.length - 1]!, tamano: datos.tamano };
}

export async function subir(
  user: SessionUser,
  id: string,
  ruta: string,
  nombre: string,
  cuerpo: Readable,
  alCancelar: (cancelar: () => void) => void,
) {
  const u = await assertPuedeUsar(user, id);
  const carpeta = smb.partirRuta(ruta);
  smb.validarNombreNuevo(nombre);
  const c = conexion(u);

  // Control previo: si ya existe, se avisa ANTES de mandar un solo byte. El
  // cambio de nombre del final vuelve a comprobarlo de forma atomica, por si
  // otra persona sube el mismo nombre mientras tanto.
  const destino = await conAnotacion(u, () => smb.info(c, carpeta));
  if (!destino || destino.tipo !== 'carpeta') throw HttpError.notFound('La carpeta ya no existe en la unidad.');
  if (await smb.info(c, [...carpeta, nombre])) throw new HttpError(409, smb.mensajeYaExiste(nombre));

  const { bytes } = await smb.subir(c, carpeta, nombre, cuerpo, alCancelar);
  const rutaFinal = [...carpeta, nombre].join('/');
  await prisma.networkDriveEvent
    .create({ data: { driveId: u.id, userId: user.id, action: 'subida', path: rutaFinal, size: BigInt(bytes) } })
    .catch((err) => logger.error({ err }, 'No se pudo registrar una subida a una unidad de red'));
  logger.info({ unidad: u.id, por: user.id, bytes }, 'Archivo subido a una unidad de red');
  return { path: rutaFinal, bytes };
}

/* ---------- Eliminacion con contrasena ---------- */

// Freno contra adivinar la contrasena de la unidad probando desde la
// plataforma. Ademas protege a la propia unidad: muchos servidores bloquean el
// usuario despues de varios intentos fallidos, y eso dejaria sin acceso a
// todos los que la usan.
const MAX_FALLAS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const fallas = new Map<string, number[]>();

function fallasRecientes(clave: string): number[] {
  const ahora = Date.now();
  const lista = (fallas.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (lista.length) fallas.set(clave, lista);
  else fallas.delete(clave);
  return lista;
}

export async function eliminarArchivo(user: SessionUser, id: string, ruta: string, password: string) {
  const u = await assertPuedeUsar(user, id);
  const partes = smb.partirRuta(ruta);
  if (!partes.length) throw HttpError.badRequest('Elegí un archivo.');
  const rutaTexto = partes.join('/');

  const clave = `${user.id}:${u.id}`;
  const recientes = fallasRecientes(clave);
  if (recientes.length >= MAX_FALLAS) {
    const minutos = Math.max(1, Math.ceil((recientes[0]! + VENTANA_MS - Date.now()) / 60000));
    throw HttpError.tooManyRequests(
      `Escribiste mal la contraseña de la unidad demasiadas veces. Esperá ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} antes de volver a intentar.`,
    );
  }

  try {
    // La eliminacion se hace con la contrasena que escribio la persona, no con
    // la guardada: si no es la correcta, el servidor de archivos la rechaza.
    await smb.eliminar(conexion(u, password), partes);
  } catch (err) {
    if (err instanceof smb.ErrorSmb && err.tipo === 'credenciales') {
      if (err.codigo === 'NT_STATUS_LOGON_FAILURE' || err.codigo === 'NT_STATUS_WRONG_PASSWORD') {
        recientes.push(Date.now());
        fallas.set(clave, recientes);
        await prisma.networkDriveEvent
          .create({ data: { driveId: u.id, userId: user.id, action: 'eliminacion_rechazada', path: rutaTexto } })
          .catch(() => undefined);
        logger.warn({ unidad: u.id, por: user.id }, 'Eliminacion en unidad de red rechazada: contraseña incorrecta');
        const quedan = MAX_FALLAS - recientes.length;
        throw new HttpError(
          403,
          'La contraseña no es correcta. El archivo no se eliminó.' +
            (quedan > 0 && quedan <= 2 ? ` Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`} antes de una espera de 15 minutos.` : ''),
        );
      }
    }
    throw err;
  }

  fallas.delete(clave);
  await prisma.networkDriveEvent
    .create({ data: { driveId: u.id, userId: user.id, action: 'eliminacion', path: rutaTexto } })
    .catch((err) => logger.error({ err }, 'No se pudo registrar una eliminacion en una unidad de red'));
  logger.info({ unidad: u.id, por: user.id }, 'Archivo eliminado de una unidad de red');
}

/* ---------- Administracion (solo Administrador) ---------- */

function resolverCredencial(authUser: { usuario: string; dominio: string | null }, domain: string | undefined) {
  // El dominio escrito aparte manda; si no se escribio, vale el de DOMINIO\usuario.
  const dominio = domain?.trim() || authUser.dominio || null;
  return { authUser: authUser.usuario, domain: dominio };
}

function serializarAdmin(u: Awaited<ReturnType<typeof filasAdmin>>[number]) {
  return {
    id: u.id,
    name: u.name,
    ruta: rutaUnc(u),
    domain: u.domain,
    authUser: u.authUser,
    status: u.status,
    lastError: u.lastError,
    lastCheckedAt: u.lastCheckedAt,
    credencialLegible: credencialLegible(u.secretCipher),
    access: u.access.map((a) => ({ id: a.id, user: a.user, sector: a.sector })),
  };
}

function credencialLegible(cipher: string): boolean {
  try {
    cripto.descifrar(cipher);
    return true;
  } catch {
    return false;
  }
}

function filasAdmin(where: { id?: string } = {}) {
  return prisma.networkDrive.findMany({
    where: { ...activa, ...where },
    include: {
      access: {
        include: { user: { select: { id: true, name: true } }, sector: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function listarTodas(user: SessionUser) {
  assertAdmin(user);
  const filas = await filasAdmin();
  return sortByName(filas, (u) => u.name).map(serializarAdmin);
}

async function unaAdmin(id: string) {
  const [fila] = await filasAdmin({ id });
  if (!fila) throw HttpError.notFound('Unidad de red no encontrada.');
  return serializarAdmin(fila);
}

export async function crear(user: SessionUser, data: CreateDriveInput) {
  assertAdmin(user);
  assertDisponible();
  const cred = resolverCredencial(data.authUser, data.domain);
  const datos = { ...data.ruta, ...cred };

  // Se prueba ANTES de guardar: nadie deberia enterarse de que la ruta o la
  // contrasena estaban mal recien cuando abre la unidad y la ve vacia.
  await smb.probar(conexion({ ...datos, secretCipher: '' }, data.password));

  const creada = await prisma.networkDrive.create({
    data: {
      name: data.name,
      host: datos.host,
      share: datos.share,
      basePath: datos.basePath,
      domain: datos.domain,
      authUser: datos.authUser,
      secretCipher: cripto.cifrar(data.password),
      lastCheckedAt: new Date(),
      createdById: user.id,
    },
  });
  logger.info({ unidad: creada.id, ruta: rutaUnc(creada), por: user.id }, 'Unidad de red vinculada');
  return unaAdmin(creada.id);
}

export async function actualizar(user: SessionUser, id: string, data: UpdateDriveInput) {
  assertAdmin(user);
  assertDisponible();
  const u = await buscar(id);

  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.status !== undefined) patch.status = data.status;
  if (data.ruta) Object.assign(patch, data.ruta);
  if (data.authUser) Object.assign(patch, resolverCredencial(data.authUser, data.domain));
  else if (data.domain !== undefined) patch.domain = data.domain.trim() || null;

  // Si cambio algo de la conexion, se vuelve a probar antes de guardar.
  const cambiaConexion = Boolean(data.ruta || data.authUser || data.password || data.domain !== undefined);
  if (cambiaConexion) {
    const fusion = { ...u, ...patch } as Unidad;
    const password = data.password ?? descifrar(u.secretCipher);
    await smb.probar(conexion(fusion, password));
    if (data.password) patch.secretCipher = cripto.cifrar(data.password);
    patch.lastError = null;
    patch.lastCheckedAt = new Date();
  }

  await prisma.networkDrive.update({ where: { id }, data: patch });
  return unaAdmin(id);
}

/**
 * Desvincula la unidad de la plataforma. NO toca nada en el servidor de
 * archivos: las carpetas y los archivos siguen exactamente donde estaban.
 */
export async function desvincular(user: SessionUser, id: string) {
  assertAdmin(user);
  await buscar(id);
  await prisma.$transaction([
    prisma.networkDriveAccess.deleteMany({ where: { driveId: id } }),
    prisma.networkDrive.update({ where: { id }, data: { deletedAt: new Date(), status: 'Inactivo' } }),
  ]);
  logger.info({ unidad: id, por: user.id }, 'Unidad de red desvinculada');
}

export async function probarAdmin(user: SessionUser, id: string) {
  assertAdmin(user);
  assertDisponible();
  const u = await buscar(id);
  const r = await conAnotacion(u, () => smb.probar(conexion(u)));
  await prisma.networkDrive.update({ where: { id }, data: { lastCheckedAt: new Date() } }).catch(() => undefined);
  return r;
}

export async function darAcceso(user: SessionUser, id: string, data: { userId?: string | null; sectorId?: string | null }) {
  assertAdmin(user);
  await buscar(id);
  if (data.userId) {
    const destino = await prisma.user.findFirst({ where: { id: data.userId, deletedAt: null }, select: { id: true } });
    if (!destino) throw HttpError.badRequest('Esa persona no existe.');
  }
  if (data.sectorId) {
    const destino = await prisma.sector.findFirst({ where: { id: data.sectorId, deletedAt: null }, select: { id: true } });
    if (!destino) throw HttpError.badRequest('Ese sector no existe.');
  }
  try {
    await prisma.networkDriveAccess.create({ data: { driveId: id, userId: data.userId ?? null, sectorId: data.sectorId ?? null } });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict(data.userId ? 'Esa persona ya tiene esta unidad.' : 'Ese sector ya tiene esta unidad.');
    throw err;
  }
  return unaAdmin(id);
}

export async function quitarAcceso(user: SessionUser, id: string, accessId: string) {
  assertAdmin(user);
  const fila = await prisma.networkDriveAccess.findUnique({ where: { id: accessId } });
  if (!fila || fila.driveId !== id) throw HttpError.notFound('Ese acceso no existe.');
  await prisma.networkDriveAccess.delete({ where: { id: accessId } });
  return unaAdmin(id);
}

export async function actividad(user: SessionUser, id: string) {
  assertAdmin(user);
  await buscar(id);
  const filas = await prisma.networkDriveEvent.findMany({
    where: { driveId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } },
  });
  return filas.map((e) => ({
    id: e.id,
    action: e.action,
    path: e.path,
    size: e.size === null ? null : Number(e.size),
    createdAt: e.createdAt,
    user: e.user,
  }));
}
