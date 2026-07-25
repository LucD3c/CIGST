import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import * as authService from './auth.service';
import { asyncHandler } from '../../utils/asyncHandler';
import type { LoginInput } from './auth.schema';

function cookieOptions(expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as LoginInput;
  const { token, expiresAt, user } = await authService.login(username, password, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
  res.status(200).json({ user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (token) await authService.logout(token);
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieOptions());
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ user: req.user ?? null });
});
