import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';

// Jerarquia: Administrador (todo) > Supervisor (ve/gestiona tickets e
// inventario de toda la empresa, sin Bitacora tecnica) > User (solo sus
// propios tickets). Nombres alineados con lo que ve el usuario en pantalla.
export const ROLES = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  USER: 'User',
} as const;

export const STAFF_ROLES = [ROLES.ADMIN, ROLES.SUPERVISOR];

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!roles.includes(req.user.role)) return next(HttpError.forbidden());
    next();
  };
}
