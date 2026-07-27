import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './db/prisma';
import { ensureUploadsDir } from './modules/attachments/attachments.storage';
import { startOrphanCleanup } from './modules/attachments/attachments.service';

const app = createApp();

// La carpeta de adjuntos tiene que existir antes de aceptar la primera
// subida (en Docker es un volumen, asi que se crea vacia la primera vez).
ensureUploadsDir();

const server = app.listen(env.PORT, () => {
  logger.info(`CIGST backend escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
  // Borra archivos que quedaron subidos pero nunca enviados: mantiene el
  // disco acotado sin intervencion manual.
  startOrphanCleanup();
});

async function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando servidor...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
