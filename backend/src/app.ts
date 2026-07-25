import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { apiRouter } from './routes';
import { attachSessionUser } from './middleware/auth.middleware';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  // CSP sin ningun origen externo: todo el JS/CSS/fuentes se sirve desde el
  // propio backend, no hay CDNs ni llamadas a otros dominios en runtime.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);

  app.use('/api', apiRouter);

  const staticDir = path.isAbsolute(env.STATIC_DIR) ? env.STATIC_DIR : path.join(__dirname, '..', env.STATIC_DIR);
  app.use(express.static(staticDir, { index: 'index.html', extensions: ['html'] }));

  app.use('/api', notFoundHandler);
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  app.use(errorHandler);

  return app;
}
