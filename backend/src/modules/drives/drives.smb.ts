// CLIENTE SMB (SAMBA / CARPETAS COMPARTIDAS DE WINDOWS)
//
// La plataforma habla con el servidor de archivos a traves de "smbclient", el
// cliente oficial del proyecto Samba. Se eligio en lugar de una libreria de
// JavaScript porque las que existen solo hablan SMB 2.0 sin firma ni cifrado,
// y un Windows Server actual (o un Windows 11 24H2) exige firma: con esas
// librerias la conexion simplemente falla. smbclient habla SMB2 y SMB3 con
// firma y cifrado, igual que el Explorador de Windows.
//
// COMO SE LE PASAN LAS ORDENES - y por que importa
//
// smbclient acepta ordenes de dos formas: con "-c" o por la entrada estandar.
// Con "-c" corta las ordenes en cada ";", AUNQUE el ";" este entre comillas
// (comprobado con smbclient 4.22). Un archivo llamado «a; del *» terminaria
// ejecutando una segunda orden. Por eso aca:
//
//   - Ningun nombre que venga de afuera (de una persona o del servidor) se
//     escribe jamas dentro de "-c". Ahi solo va el nombre temporal de una
//     subida, que lo genera la plataforma.
//   - Las ordenes van por la entrada estandar, una por linea. Ahi el ";" no
//     separa nada. Los nombres se validan para que no tengan saltos de linea,
//     comillas ni barras invertidas (la barra invertida, ademas, smbclient la
//     interpreta como caracter de escape en ese modo): asi una linea es siempre
//     exactamente una orden, con exactamente los argumentos esperados.
//   - Las carpetas se separan con "/", que smbclient convierte solo.
//   - Con "-E", todos los mensajes de smbclient salen por stderr. stdout queda
//     reservado para el contenido de un archivo que se descarga: no se mezcla
//     nunca texto de smbclient con los bytes del archivo.
//
// Los archivos NO pasan por el disco de CIGST: una descarga sale de smbclient
// directo hacia el navegador, y una subida va del navegador directo a
// smbclient. No ocupan lugar en el servidor de la plataforma ni dejan copia.

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { HttpError } from '../../utils/httpError';
import { logger } from '../../utils/logger';

export interface ConexionSmb {
  host: string;
  share: string;
  // Subcarpeta del recurso que se vinculo, ya partida en segmentos.
  base: string[];
  domain: string | null;
  usuario: string;
  password: string;
}

export interface Entrada {
  nombre: string;
  tipo: 'carpeta' | 'archivo';
  tamano: number;
  modificado: string | null;
}

/* ---------- Nombres y rutas ---------- */

// Lo que Windows no admite en un nombre de archivo, mas los caracteres de
// control. Las comillas y la barra invertida, ademas, son justo lo que podria
// alterar como lee smbclient una orden: no pueden pasar.
const CARACTERES_PROHIBIDOS = /[\u0000-\u001f\u007f"\\/:*?<>|]/;
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export const PREFIJO_TEMPORAL = '~cigst-';
const MAX_NOMBRE = 255;
const MAX_RUTA = 1024;
const MAX_PROFUNDIDAD = 64;

/** Valida UN nombre de archivo o carpeta. Lanza 400 con un motivo claro. */
export function validarNombre(nombre: string, que = 'El nombre'): string {
  if (!nombre || !nombre.trim()) throw HttpError.badRequest(`${que} está vacío.`);
  if (nombre.length > MAX_NOMBRE) throw HttpError.badRequest(`${que} es demasiado largo (máximo ${MAX_NOMBRE} caracteres).`);
  if (nombre === '.' || nombre === '..') throw HttpError.badRequest(`${que} no es válido.`);
  if (CARACTERES_PROHIBIDOS.test(nombre)) {
    throw HttpError.badRequest(`${que} tiene caracteres que no se admiten en una unidad de red: \\ / : * ? " < > |`);
  }
  return nombre;
}

/**
 * Parte una ruta relativa ("Informes/2026") en segmentos validados. Nunca
 * acepta ".." : no hay forma de salir de la carpeta que se vinculo.
 */
export function partirRuta(ruta: string | undefined | null): string[] {
  if (!ruta) return [];
  if (ruta.length > MAX_RUTA) throw HttpError.badRequest('La ruta es demasiado larga.');
  const segmentos = ruta.split('/').filter((s) => s.length > 0);
  if (segmentos.length > MAX_PROFUNDIDAD) throw HttpError.badRequest('La ruta tiene demasiadas carpetas.');
  return segmentos.map((s) => validarNombre(s, 'La ruta'));
}

/** Nombre de un archivo que se va a CREAR: ademas no puede ser un nombre reservado. */
export function validarNombreNuevo(nombre: string): string {
  validarNombre(nombre, 'El nombre del archivo');
  if (nombre !== nombre.trim() || nombre.endsWith('.')) {
    throw HttpError.badRequest('El nombre del archivo no puede empezar ni terminar con espacios, ni terminar con un punto.');
  }
  if (RESERVADOS_WINDOWS.test(nombre)) {
    throw HttpError.badRequest(`«${nombre}» es un nombre reservado de Windows. Cambiale el nombre al archivo.`);
  }
  if (nombre.toLowerCase().startsWith(PREFIJO_TEMPORAL)) {
    throw HttpError.badRequest(`Los nombres que empiezan con «${PREFIJO_TEMPORAL}» los usa la plataforma. Cambiale el nombre al archivo.`);
  }
  return nombre;
}

function rutaRemota(c: ConexionSmb, segmentos: string[]): string {
  return [...c.base, ...segmentos].join('/');
}

/* ---------- Errores ---------- */

export type TipoFalla = 'conexion' | 'credenciales' | 'operacion';

export class ErrorSmb extends HttpError {
  codigo: string;
  tipo: TipoFalla;
  constructor(status: number, mensaje: string, codigo: string, tipo: TipoFalla) {
    super(status, mensaje);
    this.name = 'ErrorSmb';
    this.codigo = codigo;
    this.tipo = tipo;
  }
}

// IMPORTANTE: ninguno usa 401. En la interfaz, un 401 significa "se vencio la
// sesion de CIGST" y saca a la persona al login.
const ERRORES: Record<string, [number, TipoFalla, string]> = {
  NT_STATUS_LOGON_FAILURE: [409, 'credenciales', 'El servidor de archivos rechazó el usuario o la contraseña de la unidad.'],
  NT_STATUS_WRONG_PASSWORD: [409, 'credenciales', 'El servidor de archivos rechazó el usuario o la contraseña de la unidad.'],
  NT_STATUS_ACCOUNT_LOCKED_OUT: [409, 'credenciales', 'El usuario de la unidad está bloqueado en el servidor de archivos (demasiados intentos fallidos). Pedile a quien administra el servidor que lo desbloquee.'],
  NT_STATUS_ACCOUNT_DISABLED: [409, 'credenciales', 'El usuario de la unidad está deshabilitado en el servidor de archivos.'],
  NT_STATUS_ACCOUNT_RESTRICTION: [409, 'credenciales', 'El servidor de archivos no permite iniciar sesión con este usuario (restricción de cuenta).'],
  NT_STATUS_PASSWORD_EXPIRED: [409, 'credenciales', 'La contraseña del usuario de la unidad venció en el servidor de archivos.'],
  NT_STATUS_PASSWORD_MUST_CHANGE: [409, 'credenciales', 'El servidor de archivos pide cambiar la contraseña del usuario de la unidad antes de usarla.'],
  NT_STATUS_ACCESS_DENIED: [403, 'operacion', 'El servidor de archivos no permite esta operación con el usuario de la unidad.'],
  NT_STATUS_BAD_NETWORK_NAME: [502, 'conexion', 'El servidor de archivos respondió, pero no tiene una carpeta compartida con ese nombre.'],
  NT_STATUS_OBJECT_NAME_NOT_FOUND: [404, 'operacion', 'El archivo o la carpeta ya no existe en la unidad.'],
  NT_STATUS_OBJECT_PATH_NOT_FOUND: [404, 'operacion', 'La carpeta ya no existe en la unidad.'],
  NT_STATUS_NO_SUCH_FILE: [404, 'operacion', 'El archivo ya no existe en la unidad.'],
  NT_STATUS_NOT_FOUND: [404, 'operacion', 'El archivo o la carpeta ya no existe en la unidad.'],
  NT_STATUS_OBJECT_NAME_COLLISION: [409, 'operacion', 'Ya existe un archivo con ese nombre en esta carpeta.'],
  NT_STATUS_SHARING_VIOLATION: [409, 'operacion', 'El archivo está abierto por otra persona o programa. Cerralo e intentá de nuevo.'],
  NT_STATUS_FILE_IS_A_DIRECTORY: [400, 'operacion', 'Eso es una carpeta, no un archivo.'],
  NT_STATUS_NOT_A_DIRECTORY: [400, 'operacion', 'Eso es un archivo, no una carpeta.'],
  NT_STATUS_CANNOT_DELETE: [409, 'operacion', 'El servidor de archivos no permite eliminar ese archivo (puede ser de solo lectura).'],
  NT_STATUS_DISK_FULL: [507, 'operacion', 'El servidor de archivos se quedó sin espacio.'],
  NT_STATUS_QUOTA_EXCEEDED: [507, 'operacion', 'Se superó el espacio asignado a este usuario en el servidor de archivos.'],
  NT_STATUS_FILE_TOO_LARGE: [413, 'operacion', 'El servidor de archivos no acepta un archivo de ese tamaño.'],
  NT_STATUS_OBJECT_NAME_INVALID: [400, 'operacion', 'El servidor de archivos no acepta ese nombre.'],
  NT_STATUS_IO_TIMEOUT: [502, 'conexion', 'El servidor de archivos no respondió a tiempo. Comprobá que esté encendido y que la red llegue hasta él.'],
  NT_STATUS_HOST_UNREACHABLE: [502, 'conexion', 'No se puede llegar al servidor de archivos por la red.'],
  NT_STATUS_NETWORK_UNREACHABLE: [502, 'conexion', 'No se puede llegar al servidor de archivos por la red.'],
  NT_STATUS_CONNECTION_REFUSED: [502, 'conexion', 'El servidor de archivos rechazó la conexión (¿está compartiendo archivos por el puerto 445?).'],
  NT_STATUS_CONNECTION_RESET: [502, 'conexion', 'Se cortó la conexión con el servidor de archivos.'],
  NT_STATUS_CONNECTION_DISCONNECTED: [502, 'conexion', 'Se cortó la conexión con el servidor de archivos.'],
  NT_STATUS_UNSUCCESSFUL: [502, 'conexion', 'No se pudo conectar con el servidor de archivos.'],
  NT_STATUS_BAD_NETWORK_PATH: [502, 'conexion', 'No se encontró el servidor de archivos en la red.'],
  NT_STATUS_INVALID_NETWORK_RESPONSE: [502, 'conexion', 'El servidor de archivos dio una respuesta que no se entiende (¿solo habla SMB1? Ese protocolo no se admite por inseguro).'],
  NT_STATUS_NOT_SUPPORTED: [502, 'conexion', 'El servidor de archivos no admite la operación o el protocolo (¿solo habla SMB1? Ese protocolo no se admite por inseguro).'],
};

const RE_ESTADO = /NT_STATUS_[A-Z0-9_]+/;

/** Traduce lo que dijo smbclient a un error entendible. null = no hubo error. */
function errorDesdeSalida(salida: string, codigoSalida: number | null): ErrorSmb | null {
  const estado = salida.match(RE_ESTADO)?.[0];
  if (estado) {
    const conocido = ERRORES[estado];
    if (conocido) return new ErrorSmb(conocido[0], conocido[2], estado, conocido[1]);
    return new ErrorSmb(502, `El servidor de archivos respondió con un error (${estado}).`, estado, 'operacion');
  }
  if (codigoSalida !== 0) {
    if (/resolve|unknown host|not known/i.test(salida)) {
      return new ErrorSmb(
        502,
        'No se encontró el servidor de archivos por su nombre. Usá la dirección IP del servidor (por ejemplo \\\\192.168.1.10\\Compartido).',
        'NOMBRE_NO_RESUELVE',
        'conexion',
      );
    }
    return new ErrorSmb(502, 'No se pudo conectar con el servidor de archivos.', 'DESCONOCIDO', 'conexion');
  }
  return null;
}

/* ---------- Limite de procesos simultaneos ---------- */

// Cada operacion es un proceso smbclient (unos 10 MB de memoria). Se acota
// cuantos corren a la vez para que una oficina entera abriendo carpetas al
// mismo tiempo no deje sin memoria a la maquina donde corre la plataforma.
class Turnos {
  private activos = 0;
  private cola: (() => void)[] = [];
  constructor(private maximo: number, private maximoEnCola: number, private aviso: string) {}

  async tomar(): Promise<() => void> {
    if (this.activos >= this.maximo) {
      if (this.cola.length >= this.maximoEnCola) throw new HttpError(503, this.aviso);
      await new Promise<void>((resolve) => this.cola.push(resolve));
    } else {
      this.activos++;
    }
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      const siguiente = this.cola.shift();
      if (siguiente) siguiente();
      else this.activos--;
    };
  }
}

const turnosOperaciones = new Turnos(16, 200, 'Hay muchas operaciones con unidades de red en curso. Probá de nuevo en unos segundos.');
const turnosTransferencias = new Turnos(10, 30, 'Hay muchas transferencias de archivos en curso. Probá de nuevo en un rato.');

/* ---------- Ejecucion de smbclient ---------- */

const TIEMPO_OPERACION_MS = 45_000;

function argumentosBase(c: ConexionSmb): string[] {
  const args = [
    '-E',
    `//${c.host}/${c.share}`,
    '-U', c.usuario,
    '-p', '445',
    // Tiempo maximo de espera de cada pedido al servidor, en segundos.
    '-t', '60',
    // Solo DNS / archivo hosts. La difusion NetBIOS no sale de un contenedor
    // y solo agregaria segundos de espera antes de fallar.
    '--option=name resolve order=host',
  ];
  if (c.domain) args.push('-W', c.domain);
  return args;
}

function lanzar(c: ConexionSmb, extra: string[]): ChildProcess {
  return spawn('smbclient', [...argumentosBase(c), ...extra], {
    // La contrasena viaja por variable de entorno: asi no aparece en la lista
    // de procesos del sistema, como pasaria si fuera un argumento.
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      PASSWD: c.password,
      // Las fechas del listado se leen en UTC y se convierten despues: asi no
      // dependen de que el contenedor tenga instalada la base de zonas horarias.
      TZ: 'UTC',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Una tanda de ordenes por la entrada estandar. Devuelve lo que contesto. */
async function ordenes(c: ConexionSmb, lineas: string[]): Promise<string> {
  for (const l of lineas) {
    // Defensa en profundidad: aunque cada nombre ya se valido, una orden no
    // puede tener jamas un salto de linea adentro.
    if (/[\r\n]/.test(l)) throw HttpError.badRequest('Nombre de archivo no válido.');
  }
  const liberar = await turnosOperaciones.tomar();
  try {
    return await new Promise<string>((resolve, reject) => {
      const p = lanzar(c, []);
      let salida = '';
      const corte = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new ErrorSmb(504, 'El servidor de archivos tardó demasiado en responder.', 'TIEMPO_AGOTADO', 'conexion'));
      }, TIEMPO_OPERACION_MS);
      p.stdout!.resume(); // en estas ordenes stdout queda vacio, pero se drena igual
      p.stderr!.setEncoding('utf8');
      p.stderr!.on('data', (d: string) => {
        if (salida.length < 4_000_000) salida += d;
      });
      p.stdin!.on('error', () => undefined); // si smbclient sale antes, no es un error propio
      p.on('error', (err) => {
        clearTimeout(corte);
        logger.error({ err }, 'No se pudo ejecutar smbclient');
        reject(new HttpError(500, 'El servidor de la plataforma no tiene instalado el cliente de unidades de red (smbclient).'));
      });
      p.on('close', (codigo) => {
        clearTimeout(corte);
        const err = errorDesdeSalida(salida, codigo);
        if (err) reject(err);
        else resolve(salida);
      });
      p.stdin!.end(lineas.map((l) => l + '\n').join(''));
    });
  } finally {
    liberar();
  }
}

/* ---------- Listado ---------- */

// Formato de una linea de "ls" de smbclient:
//   "  Informe 2026.pdf                    A   183422  Thu Nov 19 00:01:37 2026"
// El nombre puede tener espacios; lo que viene despues (atributos, tamanio y
// fecha) tiene forma fija, y es lo que permite separarlo sin ambiguedad.
const RE_LINEA =
  /^ {2}(.+?)\s+([A-Z]+)\s+(\d+)\s+[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;
const MESES: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parsearListado(salida: string): (Entrada & { atributos: string })[] {
  const entradas: (Entrada & { atributos: string })[] = [];
  for (const linea of salida.split('\n')) {
    const m = RE_LINEA.exec(linea.replace(/\r$/, ''));
    if (!m) continue;
    const [, nombre, atributos, tamano, mes, dia, h, min, s, anio] = m;
    if (nombre === '.' || nombre === '..') continue;
    const fecha = new Date(Date.UTC(Number(anio), MESES[mes!] ?? 0, Number(dia), Number(h), Number(min), Number(s)));
    entradas.push({
      nombre: nombre!,
      tipo: atributos!.includes('D') ? 'carpeta' : 'archivo',
      tamano: Number(tamano),
      modificado: Number.isNaN(fecha.getTime()) ? null : fecha.toISOString(),
      atributos: atributos!,
    });
  }
  return entradas;
}

/**
 * Contenido de una carpeta de la unidad. Se esconden, como hace el Explorador
 * de Windows, los archivos ocultos y de sistema (desktop.ini, Thumbs.db) y
 * los temporales de una subida en curso.
 */
export async function listar(c: ConexionSmb, carpeta: string[]): Promise<Entrada[]> {
  const ruta = rutaRemota(c, carpeta);
  const salida = await ordenes(c, [`ls "${ruta ? `${ruta}/*` : '*'}"`]);
  return parsearListado(salida)
    .filter((e) => !e.atributos.includes('H') && !e.atributos.includes('S'))
    .filter((e) => !e.nombre.toLowerCase().startsWith(PREFIJO_TEMPORAL))
    .map(({ atributos: _a, ...e }) => e);
}

/** Datos de UN archivo o carpeta. null si no existe. */
export async function info(c: ConexionSmb, ruta: string[]): Promise<Entrada | null> {
  if (!ruta.length) return { nombre: '', tipo: 'carpeta', tamano: 0, modificado: null };
  try {
    const salida = await ordenes(c, [`ls "${rutaRemota(c, ruta)}"`]);
    const nombre = ruta[ruta.length - 1]!.toLowerCase();
    const encontrada = parsearListado(salida).find((e) => e.nombre.toLowerCase() === nombre);
    if (!encontrada) return null;
    const { atributos: _a, ...e } = encontrada;
    return e;
  } catch (err) {
    if (err instanceof ErrorSmb && err.status === 404) return null;
    throw err;
  }
}

/** Comprueba que la unidad responde con la credencial guardada. */
export async function probar(c: ConexionSmb): Promise<{ elementos: number }> {
  const entradas = await listar(c, []);
  return { elementos: entradas.length };
}

/* ---------- Descarga ---------- */

export interface Descarga {
  datos: Readable;
  // Se resuelve cuando smbclient termina; rechaza si fallo a mitad de camino.
  fin: Promise<void>;
  cancelar: () => void;
}

/**
 * Empieza a bajar un archivo. La promesa se resuelve recien cuando llega el
 * primer pedazo (o cuando termina un archivo vacio): si el servidor rechaza
 * la descarga, se puede devolver un error claro en vez de un archivo roto.
 */
export async function descargar(c: ConexionSmb, ruta: string[]): Promise<Descarga> {
  const liberar = await turnosTransferencias.tomar();
  const p = lanzar(c, []);
  let salida = '';
  p.stderr!.setEncoding('utf8');
  p.stderr!.on('data', (d: string) => {
    if (salida.length < 1_000_000) salida += d;
  });
  p.stdin!.on('error', () => undefined);

  const fin = new Promise<void>((resolve, reject) => {
    p.on('error', (err) => {
      liberar();
      logger.error({ err }, 'No se pudo ejecutar smbclient');
      reject(new HttpError(500, 'El servidor de la plataforma no tiene instalado el cliente de unidades de red (smbclient).'));
    });
    p.on('close', (codigo, senal) => {
      liberar();
      if (senal) return reject(new HttpError(499, 'Descarga cancelada.'));
      const err = errorDesdeSalida(salida, codigo);
      if (err) reject(err);
      else resolve();
    });
  });
  fin.catch(() => undefined); // quien la use decide; aca no queda sin atender

  p.stdin!.end(`get "${rutaRemota(c, ruta)}" -\n`);

  await new Promise<void>((resolve, reject) => {
    const datos = p.stdout!;
    const listo = () => {
      datos.off('readable', alLeer);
      resolve();
    };
    const alLeer = () => {
      if (datos.readableLength > 0) listo();
    };
    datos.on('readable', alLeer);
    fin.then(listo, (err) => {
      datos.off('readable', alLeer);
      // Si ya habia datos, el error se informa por "fin" a quien este copiando.
      if (datos.readableLength > 0) resolve();
      else reject(err);
    });
  });

  return {
    datos: p.stdout!,
    fin,
    cancelar: () => {
      if (p.exitCode === null) p.kill('SIGKILL');
    },
  };
}

/* ---------- Subida ---------- */

/**
 * Sube un archivo SIN sobreescribir nunca nada:
 *
 *   1. Se escribe con un nombre temporal que genera la plataforma.
 *   2. Se renombra al nombre real. El servidor de archivos rechaza el cambio
 *      de nombre si ya existe un archivo con ese nombre (incluso si otra
 *      persona lo creo un segundo antes), asi que es imposible pisar uno.
 *   3. Si algo falla, se borra el temporal.
 *
 * El contenido va del navegador directo al servidor de archivos: no se guarda
 * en el disco de CIGST.
 */
export async function subir(
  c: ConexionSmb,
  carpeta: string[],
  nombre: string,
  cuerpo: Readable,
  alCancelar: (cancelar: () => void) => void,
): Promise<{ bytes: number }> {
  validarNombreNuevo(nombre);
  const temporal = `${PREFIJO_TEMPORAL}${crypto.randomBytes(8).toString('hex')}.tmp`;
  const rutaCarpeta = rutaRemota(c, carpeta);

  const liberar = await turnosTransferencias.tomar();
  let bytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      // La carpeta va con "-D" (es un argumento, no una orden: el ";" no la
      // parte) y en "-c" va solamente el nombre temporal, que es nuestro.
      const extra = rutaCarpeta ? ['-D', rutaCarpeta.split('/').join('\\')] : [];
      const p = lanzar(c, [...extra, '-c', `put - "${temporal}"`]);
      let salida = '';
      let cancelado = false;
      p.stdout!.resume();
      p.stderr!.setEncoding('utf8');
      p.stderr!.on('data', (d: string) => {
        if (salida.length < 1_000_000) salida += d;
      });
      const contador = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          cb(null, chunk);
        },
      });
      p.stdin!.on('error', () => undefined);
      cuerpo.on('error', () => p.kill('SIGKILL'));
      cuerpo.pipe(contador).pipe(p.stdin!);
      alCancelar(() => {
        cancelado = true;
        if (p.exitCode === null) p.kill('SIGKILL');
      });
      p.on('error', (err) => {
        logger.error({ err }, 'No se pudo ejecutar smbclient');
        reject(new HttpError(500, 'El servidor de la plataforma no tiene instalado el cliente de unidades de red (smbclient).'));
      });
      p.on('close', (codigo, senal) => {
        cuerpo.unpipe(contador);
        if (cancelado || senal) return reject(new HttpError(499, 'Subida cancelada.'));
        const err = errorDesdeSalida(salida, codigo);
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    await borrarSinPreguntar(c, [...carpeta, temporal]);
    throw err;
  } finally {
    liberar();
  }

  try {
    await ordenes(c, [`rename "${rutaRemota(c, [...carpeta, temporal])}" "${rutaRemota(c, [...carpeta, nombre])}"`]);
  } catch (err) {
    await borrarSinPreguntar(c, [...carpeta, temporal]);
    if (err instanceof ErrorSmb && err.codigo === 'NT_STATUS_OBJECT_NAME_COLLISION') {
      throw new ErrorSmb(409, mensajeYaExiste(nombre), err.codigo, 'operacion');
    }
    throw err;
  }
  return { bytes };
}

export function mensajeYaExiste(nombre: string): string {
  return `Ya existe un archivo llamado «${nombre}» en esta carpeta. Los archivos no se sobreescriben: ` +
    'eliminá el que está en la unidad o cambiale el nombre al archivo que estás subiendo.';
}

// Limpieza de un temporal propio. Nunca falla: si no se puede borrar, queda
// oculto en los listados (empieza con el prefijo de la plataforma).
async function borrarSinPreguntar(c: ConexionSmb, ruta: string[]) {
  try {
    await ordenes(c, [`del "${rutaRemota(c, ruta)}"`]);
  } catch (err) {
    if (!(err instanceof ErrorSmb && err.status === 404)) {
      logger.warn({ codigo: (err as ErrorSmb).codigo }, 'No se pudo borrar un archivo temporal de una subida a una unidad de red');
    }
  }
}

/* ---------- Eliminacion ---------- */

/**
 * Elimina UN archivo. Se ejecuta con la contrasena que escribio la persona en
 * ese momento (no con la guardada): es el propio servidor de archivos el que
 * confirma quien elimina. Nunca borra carpetas, y como los nombres no pueden
 * tener comodines (* ?), nunca alcanza a mas de un archivo.
 */
export async function eliminar(c: ConexionSmb, ruta: string[]): Promise<void> {
  if (!ruta.length) throw HttpError.badRequest('Falta el archivo a eliminar.');
  await ordenes(c, [`del "${rutaRemota(c, ruta)}"`]);
}
