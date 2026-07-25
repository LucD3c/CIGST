import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';

export const ROLES = {
  ADMIN: 'Administrador',
  TECH: 'Técnico',
  EMPLOYEE: 'Empleado',
} as const;

export const STAFF_ROLES = [ROLES.ADMIN, ROLES.TECH];

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!roles.includes(req.user.role)) return next(HttpError.forbidden());
    next();
  };
}
