import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import * as authService from './auth.service';
import { direccionDe } from './auth.red';
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

async function withEmployeeContext(user: authService.SessionUser) {
  if (!user.employeeId) return { ...user, employee: null };
  const employee = await authService.getOwnEmployeeContext(user.employeeId);
  return { ...user, employee };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as LoginInput;
  const { token, expiresAt, user } = await authService.login(username, password, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
  res.status(200).json({ user: await withEmployeeContext(user) });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (token) await authService.logout(token);
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieOptions());
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) return res.status(200).json({ user: null });
  res.status(200).json({ user: await withEmployeeContext(req.user) });
});

// Direccion de red de la maquina que hace el pedido. No recibe ningun
// parametro a proposito: no hay forma de pedir la direccion de otra persona.
// Ver el comentario largo en auth.red.ts.
export const miIp = asyncHandler(async (req: Request, res: Response) => {
  const info = direccionDe(req);
  res.json({ red: info });
});
