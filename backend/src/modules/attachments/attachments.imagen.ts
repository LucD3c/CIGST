import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { uploadsDir, filePathFor } from './attachments.storage';

// ---------------------------------------------------------------------------
// Compresion de imagenes EN EL SERVIDOR.
//
// El navegador ya comprime antes de subir, y eso cubre el uso normal. Pero esa
// compresion es del lado del cliente: cualquiera que le pegue directo a la API
// (un script, una app propia, curl) la saltea, y ahi entraba una imagen de
// 10 MB tal cual. Esta pasada es la red de contencion: corre SIEMPRE, venga de
// donde venga el archivo, y deja el disco acotado de verdad.
//
// Que NO hace, a proposito:
//   - No toca PDF, planillas ni ningun archivo que no sea imagen.
//   - No toca los GIF: convertirlos perderia la animacion.
//   - No reemplaza el original si el resultado no es mas chico. Si comprimir
//     no mejora nada, se queda el archivo tal como llego.
//
// Si la libreria de imagenes no estuviera disponible por lo que fuera, la
// funcion devuelve null y la subida sigue su curso con el archivo original: un
// problema al comprimir nunca puede hacer fallar una subida.
// ---------------------------------------------------------------------------

// Debajo de este tamanio no vale la pena recomprimir si ademas la imagen ya
// entra en el lado maximo: el ahorro seria marginal y la recompresion solo
// degradaria la calidad.
const MIN_BYTES = 200 * 1024;

const COMPRIMIBLES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ImagenComprimida {
  storedName: string;
  mimeType: string;
  size: number;
}

// Carga perezosa: si sharp faltara, se avisa una sola vez y la plataforma
// sigue funcionando sin compresion del lado del servidor.
//
// El tipo apunta al export por defecto: desde la version 0.35 la libreria
// declara sus tipos al estilo de los modulos ES, con lo cual el modulo entero
// ya no figura como invocable aunque en ejecucion require() siga devolviendo
// la funcion de siempre.
type Sharp = typeof import('sharp').default;
let sharpMod: Sharp | null | undefined;

function cargarSharp(): Sharp | null {
  if (sharpMod !== undefined) return sharpMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    sharpMod = require('sharp') as Sharp;
  } catch (err) {
    logger.warn(
      { err },
      'No se pudo cargar la libreria de imagenes: las imagenes se guardan sin comprimir del lado del servidor.',
    );
    sharpMod = null;
  }
  return sharpMod;
}

/**
 * Recomprime una imagen ya escrita en disco. Devuelve los datos del archivo
 * nuevo, o null si no habia nada que hacer (o si algo fallo, en cuyo caso se
 * conserva el original intacto).
 */
export async function comprimirImagen(
  storedName: string,
  mimeType: string,
  sizeOriginal: number,
): Promise<ImagenComprimida | null> {
  if (!COMPRIMIBLES.has(mimeType)) return null;

  const sharp = cargarSharp();
  if (!sharp) return null;

  const origen = filePathFor(storedName);
  const destinoNombre = `${randomUUID()}.webp`;
  const destino = path.join(uploadsDir(), destinoNombre);

  try {
    const img = sharp(origen, { failOn: 'none' });
    const meta = await img.metadata();
    const ladoMayor = Math.max(meta.width ?? 0, meta.height ?? 0);

    // Ya es chica en bytes Y en dimensiones: no se toca. (El control mira las
    // dos cosas: una imagen de 2400x1600 con colores planos puede pesar poco y
    // aun asi convenir redimensionarla.)
    if (sizeOriginal < MIN_BYTES && ladoMayor > 0 && ladoMayor <= env.IMAGEN_MAX_LADO) {
      return null;
    }

    await img
      .rotate() // respeta la orientacion EXIF antes de redimensionar
      .resize({
        width: env.IMAGEN_MAX_LADO,
        height: env.IMAGEN_MAX_LADO,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: Math.round(env.IMAGEN_CALIDAD * 100) })
      .toFile(destino);

    const stat = await fs.promises.stat(destino);

    // Si comprimir no achico nada, se descarta el resultado y queda el original.
    if (stat.size >= sizeOriginal) {
      await fs.promises.unlink(destino).catch(() => undefined);
      return null;
    }

    // Recien ahora se borra el original: si algo hubiera fallado antes, el
    // archivo que llego sigue estando.
    await fs.promises.unlink(origen).catch(() => undefined);

    return { storedName: destinoNombre, mimeType: 'image/webp', size: stat.size };
  } catch (err) {
    logger.warn({ err, storedName }, 'No se pudo comprimir la imagen: se guarda el archivo original.');
    await fs.promises.unlink(destino).catch(() => undefined);
    return null;
  }
}
