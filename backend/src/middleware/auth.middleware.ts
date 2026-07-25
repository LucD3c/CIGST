import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { resolveSession } from '../modules/auth/auth.service';
import { HttpError } from '../utils/httpError';
import { asyncHandler } from '../utils/asyncHandler';

export const attachSessionUser = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (token) {
    const user = await resolveSession(token);
    if (user) req.user = user;
  }
  next();
});

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(HttpError.unauthorized());
  next();
}
