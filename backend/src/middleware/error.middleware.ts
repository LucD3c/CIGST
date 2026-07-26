import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

// body-parser (express.json) lanza errores (JSON invalido, body demasiado
// grande, etc.) con status/expose propios via la convencion de http-errors.
// No son HttpError nuestro, pero siguen siendo errores del cliente: hay que
// responder 4xx, no 500.
function isClientBodyParserError(err: unknown): err is Error & { status: number; expose: boolean } {
  if (!(err instanceof Error)) return false;
  const candidate: unknown = err;
  const { status, expose } = candidate as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  if (isClientBodyParserError(err)) {
    res.status(err.status).json({ error: 'El cuerpo de la solicitud es inválido o demasiado grande.' });
    return;
  }

  logger.error({ err }, 'Error no controlado');
  res.status(500).json({ error: 'Error interno del servidor.' });
}
