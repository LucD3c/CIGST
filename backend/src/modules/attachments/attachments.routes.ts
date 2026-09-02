import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import * as controller from './attachments.controller';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { uploadRateLimiter } from '../../middleware/rateLimit.middleware';
import { uploader, MAX_FILE_BYTES, MAX_FILES_PER_REQUEST } from './attachments.storage';
import { HttpError } from '../../utils/httpError';
import { assertHayEspacio } from '../../maintenance/disco.service';
import { asyncHandler } from '../../utils/asyncHandler';

export const attachmentsRouter = Router();

// Adjuntar y descargar esta abierto a los 3 roles: quien puede crear un
// ticket o escribir un mensaje puede adjuntarle archivos. El control de
// acceso real esta en la descarga (solo ve el archivo quien puede ver el
// ticket o el mensaje que lo contiene, ver attachments.service).
attachmentsRouter.use(requireAuth);

// Traduce los errores de multer a mensajes claros en vez de un 500 crudo.
function handleUploadErrors(err: unknown, _req: Request, _res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(HttpError.badRequest(`Cada archivo puede pesar hasta ${MAX_FILE_BYTES / (1024 * 1024)} MB.`));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(HttpError.badRequest(`Se pueden adjuntar hasta ${MAX_FILES_PER_REQUEST} archivos por vez.`));
    }
    return next(HttpError.badRequest('No se pudo procesar el archivo adjunto.'));
  }
  if (err instanceof Error && err.message === 'TIPO_NO_PERMITIDO') {
    return next(
      HttpError.badRequest('Solo se aceptan imágenes (PNG, JPG, GIF, WEBP), PDF y planillas (XLSX, XLS, CSV).'),
    );
  }
  return next(err);
}

// Freno de disco ANTES de que multer escriba nada: si no hay lugar, ni
// siquiera se genera un archivo a medias. Lo ya guardado no se toca nunca.
const controlarEspacio = asyncHandler(async (_req, _res, next) => {
  await assertHayEspacio();
  next();
});

attachmentsRouter.post(
  '/',
  uploadRateLimiter,
  controlarEspacio,
  uploader.array('files', MAX_FILES_PER_REQUEST),
  handleUploadErrors,
  controller.upload,
);

attachmentsRouter.get('/:id', validate({ params: idParamSchema }), controller.download);
