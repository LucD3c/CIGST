import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  logger.error({ err }, 'Error no controlado');
  res.status(500).json({ error: 'Error interno del servidor.' });
}
