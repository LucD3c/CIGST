import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { uploadsDir } from '../modules/attachments/attachments.storage';

// ---------------------------------------------------------------------------
// Limpieza de datos SIN USO.
//
// Regla que manda sobre todo lo demas: NO SE PIERDE NADA QUE LE SIRVA A NADIE.
// Ni un ticket, ni un mensaje, ni una imagen, ni un PDF, ni una planilla, ni
// una conversacion, ni un articulo. Ni siquiera los registros dados de baja:
// el borrado de la plataforma es logico (deleted_at) y esos datos se conservan
// para siempre, porque un dia alguien puede necesitar consultarlos.
//
// Lo unico que se elimina son datos que por definicion ya no le sirven a
// ninguna persona:
//
//   1. Sesiones VENCIDAS. Son tokens muertos: la plataforma los rechaza igual.
//      Nadie puede volver a usarlos ni consultarlos.
//   2. Intentos de login viejos. Solo existen para contar fuerza bruta dentro
//      de una ventana de minutos; pasada esa ventana no significan nada.
//   3. Avisos (campanita) YA LEIDOS y antiguos. Un aviso es apenas un puntero
//      a un ticket o a un mensaje que sigue existiendo intacto: borrar el
//      aviso no borra aquello a lo que apunta.
//   4. Lecturas de publicaciones que ya fueron dadas de baja. Es el "visto" de
//      algo que ya no se muestra.
//   5. Archivos huerfanos en disco: archivos fisicos sin ninguna fila en la
//      base que los referencie. Son inalcanzables desde la interfaz -nadie
//      puede abrirlos ni descargarlos- y solo ocupan lugar. Se borran con
//      doble verificacion y solo si superan un margen de antiguedad, para no
//      pisar una subida que este ocurriendo en ese mismo instante.
// ---------------------------------------------------------------------------

export interface ResultadoLimpieza {
  sesionesVencidas: number;
  intentosLogin: number;
  avisosLeidos: number;
  avisosSinLeerAntiguos: number;
  lecturasDePublicacionesBajas: number;
  archivosHuerfanos: number;
  bytesLiberados: number;
  errores: string[];
}

const DIA_MS = 24 * 60 * 60 * 1000;

// Margen de seguridad para los archivos sueltos en disco: un archivo recien
// escrito por multer puede no tener todavia su fila en la base (la subida esta
// en curso). Con 24 horas de margen es imposible pisar una subida activa.
const MARGEN_ARCHIVO_HUERFANO_MS = 24 * 60 * 60 * 1000;

export async function limpiarDatosSinUso(): Promise<ResultadoLimpieza> {
  const r: ResultadoLimpieza = {
    sesionesVencidas: 0,
    intentosLogin: 0,
    avisosLeidos: 0,
    avisosSinLeerAntiguos: 0,
    lecturasDePublicacionesBajas: 0,
    archivosHuerfanos: 0,
    bytesLiberados: 0,
    errores: [],
  };

  // 1. Sesiones vencidas -----------------------------------------------------
  // Antes solo se borraba una sesion si alguien intentaba usar ese token
  // exacto, cosa que con un token vencido no pasa nunca: quedaban para siempre.
  try {
    const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    r.sesionesVencidas = count;
  } catch (err) {
    r.errores.push(`sesiones: ${(err as Error).message}`);
  }

  // 2. Intentos de login fuera de toda ventana de bloqueo --------------------
  try {
    const { count } = await prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - DIA_MS) } },
    });
    r.intentosLogin = count;
  } catch (err) {
    r.errores.push(`intentos de login: ${(err as Error).message}`);
  }

  // 3. Avisos ya leidos y antiguos -------------------------------------------
  try {
    const corteLeidas = new Date(Date.now() - env.RETENTION_NOTIF_LEIDAS_DIAS * DIA_MS);
    const { count } = await prisma.notification.deleteMany({
      where: { readAt: { not: null, lt: corteLeidas } },
    });
    r.avisosLeidos = count;
  } catch (err) {
    r.errores.push(`avisos leidos: ${(err as Error).message}`);
  }

  // Avisos que nadie leyo nunca y ya son muy viejos. El plazo por defecto es
  // de un anio entero: a esa altura el ticket al que apuntan ya se cerro hace
  // mucho, y el ticket -que es el dato real- sigue estando.
  try {
    const corteSinLeer = new Date(Date.now() - env.RETENTION_NOTIF_SIN_LEER_DIAS * DIA_MS);
    const { count } = await prisma.notification.deleteMany({
      where: { readAt: null, createdAt: { lt: corteSinLeer } },
    });
    r.avisosSinLeerAntiguos = count;
  } catch (err) {
    r.errores.push(`avisos sin leer: ${(err as Error).message}`);
  }

  // 4. "Visto" de publicaciones dadas de baja --------------------------------
  try {
    const { count } = await prisma.postView.deleteMany({
      where: { post: { deletedAt: { not: null } } },
    });
    r.lecturasDePublicacionesBajas = count;
  } catch (err) {
    r.errores.push(`lecturas de publicaciones: ${(err as Error).message}`);
  }

  // 5. Archivos huerfanos en disco -------------------------------------------
  try {
    const huerfanos = await borrarArchivosHuerfanos();
    r.archivosHuerfanos = huerfanos.cantidad;
    r.bytesLiberados = huerfanos.bytes;
  } catch (err) {
    r.errores.push(`archivos huerfanos: ${(err as Error).message}`);
  }

  return r;
}

// Archivos que estan en el volumen de uploads pero no tienen fila en la tabla
// de adjuntos. Pasa cuando el proceso se corta entre que multer escribe el
// archivo y que se guarda su registro. Sin fila, el archivo es INALCANZABLE:
// no hay forma de abrirlo ni descargarlo desde la plataforma, porque todas las
// descargas se resuelven por id de adjunto. Solo ocupa disco.
async function borrarArchivosHuerfanos(): Promise<{ cantidad: number; bytes: number }> {
  const dir = uploadsDir();
  if (!fs.existsSync(dir)) return { cantidad: 0, bytes: 0 };

  const enDisco = await fs.promises.readdir(dir);
  if (enDisco.length === 0) return { cantidad: 0, bytes: 0 };

  // Se traen los nombres registrados en la base en un solo viaje.
  const filas = await prisma.attachment.findMany({ select: { storedName: true } });
  const registrados = new Set(filas.map((f) => f.storedName));

  const corte = Date.now() - MARGEN_ARCHIVO_HUERFANO_MS;
  let cantidad = 0;
  let bytes = 0;

  for (const nombre of enDisco) {
    if (registrados.has(nombre)) continue;

    const completo = path.join(dir, nombre);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(completo);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    // Margen de antiguedad: nunca se toca algo escrito recien.
    if (stat.mtimeMs > corte) continue;

    // Doble verificacion contra la base justo antes de borrar: entre el
    // listado de arriba y este momento pudo registrarse el adjunto.
    const aparecio = await prisma.attachment.count({ where: { storedName: nombre } });
    if (aparecio > 0) continue;

    try {
      await fs.promises.unlink(completo);
      cantidad += 1;
      bytes += stat.size;
    } catch {
      // Si no se puede borrar, se deja: perder espacio es preferible a romper.
    }
  }

  return { cantidad, bytes };
}

export function resumenLegible(r: ResultadoLimpieza): string {
  const mb = (r.bytesLiberados / (1024 * 1024)).toFixed(1);
  return [
    `sesiones vencidas: ${r.sesionesVencidas}`,
    `intentos de login: ${r.intentosLogin}`,
    `avisos leidos: ${r.avisosLeidos}`,
    `avisos sin leer antiguos: ${r.avisosSinLeerAntiguos}`,
    `lecturas de publicaciones dadas de baja: ${r.lecturasDePublicacionesBajas}`,
    `archivos huerfanos: ${r.archivosHuerfanos} (${mb} MB)`,
  ].join(', ');
}

// --- Ejecucion automatica ----------------------------------------------------
// Cada 6 horas, mas una pasada al arrancar. Es barato (son DELETE indexados) y
// evita que la base crezca con datos muertos durante anios sin que nadie mire.
const INTERVALO_MS = 6 * 60 * 60 * 1000;

export function iniciarLimpiezaPeriodica() {
  const correr = async () => {
    try {
      const r = await limpiarDatosSinUso();
      const algo =
        r.sesionesVencidas + r.intentosLogin + r.avisosLeidos + r.avisosSinLeerAntiguos + r.archivosHuerfanos > 0;
      if (algo) logger.info({ limpieza: r }, `Limpieza de datos sin uso: ${resumenLegible(r)}`);
      if (r.errores.length) logger.warn({ errores: r.errores }, 'La limpieza termino con errores parciales.');
    } catch (err) {
      logger.error({ err }, 'Fallo la limpieza de datos sin uso.');
    }
  };

  void correr();
  const timer = setInterval(() => void correr(), INTERVALO_MS);
  timer.unref?.();
  return timer;
}
