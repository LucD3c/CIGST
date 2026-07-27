import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError } from '../../utils/httpError';
import * as service from './attachments.service';
import { isInline } from './attachments.storage';

export const upload = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw HttpError.badRequest('No se recibió ningún archivo.');

  const attachments = [];
  for (const file of files) {
    attachments.push(await service.register(file, req.user!.id));
  }
  res.status(201).json({ attachments });
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const { attachment, absolutePath } = await service.getForDownload(req.user!, req.params.id!);

  // El Content-Type sale de los bytes reales del archivo (nunca del que
  // declaro el cliente al subirlo). Solo las imagenes se muestran en linea;
  // todo lo demas se fuerza como descarga, asi el navegador nunca interpreta
  // el contenido de un PDF o una planilla dentro del origen de la app.
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const disposition = isInline(attachment.mimeType) ? 'inline' : 'attachment';
  const safeName = attachment.originalName.replace(/["\r\n]/g, '');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
  );
  // Privado: es contenido de un ticket o de un chat, no debe quedar en caches
  // compartidas. res.sendFile envia en streaming, sin cargarlo en memoria.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(absolutePath);
});
