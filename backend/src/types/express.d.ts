import type { SessionUser } from '../modules/auth/auth.service';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export {};
