import fs from 'node:fs';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { uploadsDir } from '../modules/attachments/attachments.storage';

// ---------------------------------------------------------------------------
// Control de espacio en disco.
//
// El volumen de adjuntos comparte disco con la base de datos. Si se llenara,
// Postgres dejaria de poder escribir y se caeria la plataforma ENTERA, no solo
// la subida de archivos. Por eso hay dos frenos, y los dos actuan ANTES de
// llegar a ese punto:
//
//   1. Un tope propio para los adjuntos (UPLOADS_MAX_GB).
//   2. Un margen minimo de espacio libre real en el disco fisico
//      (DISCO_MINIMO_LIBRE_MB), que protege aunque el tope de arriba este mal
//      configurado o aunque el disco se llene por fuera de la plataforma.
//
// Cuando se frena una subida NO se pierde nada de lo ya guardado: lo unico que
// pasa es que no se aceptan archivos nuevos, con un mensaje que explica que
// hacer. Todo lo que ya estaba sigue disponible y descargable.
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// El total de adjuntos se cachea unos segundos: sin esto habria una consulta
// de agregacion por cada archivo subido.
const CACHE_MS = 30_000;
let cacheBytes: number | null = null;
let cacheVence = 0;

export interface EstadoDisco {
  usadoBytes: number;
  topeBytes: number;
  porcentaje: number;
  libreEnDiscoBytes: number | null;
  enAviso: boolean;
  lleno: boolean;
}

// Suma de todos los adjuntos registrados. Es una agregacion sobre una columna
// numerica; en una tabla de decenas de miles de filas tarda milisegundos.
async function bytesUsados(forzar = false): Promise<number> {
  if (!forzar && cacheBytes !== null && Date.now() < cacheVence) return cacheBytes;
  const agg = await prisma.attachment.aggregate({ _sum: { size: true } });
  cacheBytes = agg._sum.size ?? 0;
  cacheVence = Date.now() + CACHE_MS;
  return cacheBytes;
}

// Invalida el cache: se llama despues de guardar o borrar adjuntos para que el
// proximo control vea el numero real y no uno de hace medio minuto.
export function invalidarCacheDisco() {
  cacheBytes = null;
  cacheVence = 0;
}

// Espacio libre real del sistema de archivos donde viven los adjuntos.
// Devuelve null si la plataforma corre en un sistema que no lo informa: en ese
// caso queda vigente el tope propio, que no depende del sistema operativo.
async function libreEnDisco(): Promise<number | null> {
  try {
    const st = await fs.promises.statfs(uploadsDir());
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

// Muestra el tamanio en la unidad que corresponda: decir "0.0 GB de 0.0 GB"
// no le sirve a nadie.
export function tamanioLegible(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function estadoDisco(forzar = false): Promise<EstadoDisco> {
  const usadoBytes = await bytesUsados(forzar);
  const topeBytes = env.UPLOADS_MAX_GB * GB;
  const libre = await libreEnDisco();
  const porcentaje = topeBytes > 0 ? Math.round((usadoBytes / topeBytes) * 100) : 0;

  const sinEspacioReal = libre !== null && libre < env.DISCO_MINIMO_LIBRE_MB * MB;

  return {
    usadoBytes,
    topeBytes,
    porcentaje,
    libreEnDiscoBytes: libre,
    enAviso: porcentaje >= env.UPLOADS_AVISO_PORCENTAJE,
    lleno: usadoBytes >= topeBytes || sinEspacioReal,
  };
}

// Freno previo a aceptar una subida. Se llama ANTES de que multer escriba
// nada, asi un disco lleno no llega siquiera a generar un archivo a medias.
export async function assertHayEspacio() {
  const e = await estadoDisco();

  if (e.lleno) {
    throw HttpError.badRequest(
      `No hay espacio disponible para archivos nuevos (${tamanioLegible(e.usadoBytes)} de ${tamanioLegible(e.topeBytes)}). ` +
        'Nada de lo ya guardado se perdió: seguí teniendo todos los archivos anteriores. ' +
        'Avisale al administrador para que libere espacio o amplíe el límite.',
    );
  }

  if (e.enAviso) {
    logger.warn(
      { usadoBytes: e.usadoBytes, topeBytes: e.topeBytes, porcentaje: e.porcentaje },
      `El almacenamiento de adjuntos va por el ${e.porcentaje}% del limite configurado.`,
    );
  }
}

// --- Vigilancia periodica ----------------------------------------------------
// Un aviso cada tanto en el registro, para que el administrador se entere de
// que se esta quedando sin lugar con tiempo de sobra para reaccionar.
const INTERVALO_MS = 60 * 60 * 1000;

export function iniciarVigilanciaDisco() {
  const mirar = async () => {
    try {
      const e = await estadoDisco(true);
      if (e.lleno) {
        logger.error(
          { estado: e },
          'ALMACENAMIENTO LLENO: no se aceptan archivos nuevos. Los archivos existentes siguen intactos.',
        );
      } else if (e.enAviso) {
        logger.warn({ estado: e }, `Almacenamiento de adjuntos al ${e.porcentaje}% del limite.`);
      }
    } catch (err) {
      logger.error({ err }, 'No se pudo controlar el espacio en disco.');
    }
  };

  void mirar();
  const timer = setInterval(() => void mirar(), INTERVALO_MS);
  timer.unref?.();
  return timer;
}
