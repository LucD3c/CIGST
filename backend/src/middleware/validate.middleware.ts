import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { HttpError } from '../utils/httpError';

type Schemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        return next(HttpError.badRequest('Datos inválidos en el cuerpo de la solicitud.', result.error.flatten()));
      }
      req.body = result.data;
    }
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        return next(HttpError.badRequest('Parámetros inválidos.', result.error.flatten()));
      }
      req.params = result.data;
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        return next(HttpError.badRequest('Parámetros de búsqueda inválidos.', result.error.flatten()));
      }
      req.query = result.data;
    }
    next();
  };
}
