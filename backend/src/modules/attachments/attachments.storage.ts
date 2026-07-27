import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../../config/env';

// ---------------------------------------------------------------------------
// Almacenamiento de adjuntos en disco.
//
// Rendimiento: multer.diskStorage escribe en streaming, byte a byte, hacia el
// volumen de uploads -- el archivo NUNCA se carga entero en memoria (a
// diferencia de multer.memoryStorage, que reservaria RAM del tamaño del
// archivo por cada subida simultanea). La descarga tambien va en streaming.
// Por eso subir/bajar archivos no mueve la aguja de RAM del contenedor,
// independientemente del tamaño del archivo o de cuantas personas suban a la
// vez.
//
// Disco: el limite por archivo y por request acota el crecimiento, y los
// adjuntos que quedan sueltos (subidos pero nunca enviados) se borran solos
// (ver cleanupOrphans en attachments.service).
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB por archivo
export const MAX_FILES_PER_REQUEST = 5;

export function uploadsDir() {
  return path.isAbsolute(env.UPLOADS_DIR) ? env.UPLOADS_DIR : path.join(__dirname, '..', '..', '..', env.UPLOADS_DIR);
}

export function ensureUploadsDir() {
  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function filePathFor(storedName: string) {
  // storedName lo genera el servidor (uuid + extension de una whitelist), asi
  // que no puede contener ".." ni separadores; el basename es defensa extra.
  return path.join(uploadsDir(), path.basename(storedName));
}

// Tipos aceptados. El mimeType que declara el navegador NO se usa para
// guardar ni para servir: se determina leyendo los primeros bytes reales del
// archivo (ver sniffMimeType). Deliberadamente sin SVG ni HTML: son los
// unicos formatos "imagen/documento" que un navegador ejecutaria como
// codigo si se mostraran en linea.
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.xlsx', '.xls', '.csv']);

// Los que se pueden mostrar embebidos en la interfaz (el resto se descarga).
export const INLINE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isInline(mimeType: string) {
  return INLINE_MIME_TYPES.has(mimeType);
}

function startsWith(buffer: Buffer, bytes: number[]) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

// Lee la cabecera real del archivo ya escrito y decide su tipo. Devuelve null
// si el contenido no corresponde a ningun formato permitido: en ese caso el
// archivo se borra y la subida se rechaza, aunque la extension y el
// Content-Type declarado fueran validos.
export function sniffMimeType(absolutePath: string, originalName: string): string | null {
  const fd = fs.openSync(absolutePath, 'r');
  const header = Buffer.alloc(512);
  let read = 0;
  try {
    read = fs.readSync(fd, header, 0, 512, 0);
  } finally {
    fs.closeSync(fd);
  }
  const head = header.subarray(0, read);
  const ext = path.extname(originalName).toLowerCase();

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  // XLSX/ODS son contenedores ZIP; XLS antiguo es OLE2. Se aceptan solo si la
  // extension declarada tambien es de planilla, y siempre se sirven como
  // descarga (nunca en linea), asi el navegador no los interpreta.
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) && ext === '.xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ext === '.xls') {
    return 'application/vnd.ms-excel';
  }
  // CSV no tiene firma binaria: se acepta solo por extension y siempre que el
  // contenido sea texto imprimible (sin bytes nulos ni de control raros).
  if (ext === '.csv') {
    const isText = head.every((b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f));
    return isText ? 'text/csv' : null;
  }
  return null;
}

export const uploader = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, ensureUploadsDir());
      } catch (err) {
        cb(err as Error, '');
      }
    },
    // Nombre en disco generado por el servidor: nada del nombre original
    // llega al sistema de archivos (evita path traversal y colisiones).
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ALLOWED_EXTENSIONS.has(ext) ? ext : ''}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error('TIPO_NO_PERMITIDO'));
      return;
    }
    cb(null, true);
  },
});

export function deleteFileQuiet(storedName: string) {
  fs.promises.unlink(filePathFor(storedName)).catch(() => undefined);
}
