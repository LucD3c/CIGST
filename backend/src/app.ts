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
  //
  // HSTS solo tiene sentido si la conexion es realmente HTTPS. La mayoria de
  // los despliegues de esta plataforma son HTTP simple dentro de la red
  // interna (sin certificado); si Helmet manda igual el header
  // Strict-Transport-Security, el navegador fuerza HTTPS en los pedidos
  // siguientes (styles.css/app.js) y la app deja de cargar. Se activa solo
  // cuando COOKIE_SECURE=true, es decir, cuando ya hay HTTPS delante (un
  // proxy reverso interno).
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
          // Helmet la agrega por defecto; fuerza al navegador a pedir HTTPS
          // incluso en un despliegue HTTP simple y rompe la carga de
          // styles.css/app.js. Solo tiene sentido si COOKIE_SECURE=true.
          upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: env.COOKIE_SECURE,
    }),
  );

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);

  app.use('/api', apiRouter);

  const staticDir = path.isAbsolute(env.STATIC_DIR) ? env.STATIC_DIR : path.join(__dirname, '..', env.STATIC_DIR);
  // no-cache != no guardar: el navegador conserva el archivo pero SIEMPRE
  // revalida con el servidor (304 si no cambio, baratisimo en LAN). Sin esto,
  // tras actualizar la plataforma un navegador podia quedarse con un app.js
  // nuevo y un styles.css viejo (cache heuristico) y la interfaz se rompia.
  app.use(
    express.static(staticDir, {
      index: 'index.html',
      extensions: ['html'],
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  );

  app.use('/api', notFoundHandler);
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  app.use(errorHandler);

  return app;
}
