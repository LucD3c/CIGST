import { Router } from 'express';
import * as authController from './auth.controller';
import { loginSchema } from './auth.schema';
import { validate } from '../../middleware/validate.middleware';
import { loginRateLimiter } from '../../middleware/rateLimit.middleware';
import { requireAuth } from '../../middleware/auth.middleware';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post('/logout', requireAuth, authController.logout);
authRouter.get('/me', requireAuth, authController.me);
