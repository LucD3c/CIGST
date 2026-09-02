import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './db/prisma';
import { ensureUploadsDir } from './modules/attachments/attachments.storage';
import { startOrphanCleanup } from './modules/attachments/attachments.service';
import { attachRealtime, stopRealtime } from './realtime/realtime.server';
import { iniciarLimpiezaPeriodica } from './maintenance/retencion.service';
import { iniciarVigilanciaDisco } from './maintenance/disco.service';
import { rellenarBusquedaArticulos } from './maintenance/busqueda.backfill';

const app = createApp();

// La carpeta de adjuntos tiene que existir antes de aceptar la primera
// subida (en Docker es un volumen, asi que se crea vacia la primera vez).
ensureUploadsDir();

const server = app.listen(env.PORT, () => {
  logger.info(`CIGST backend escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);

  // Borra archivos que quedaron subidos pero nunca enviados: mantiene el
  // disco acotado sin intervencion manual.
  startOrphanCleanup();

  // Limpieza periodica de datos que ya no le sirven a nadie: sesiones
  // vencidas, intentos de login viejos y avisos leidos. Nunca toca tickets,
  // mensajes, archivos, personas, equipos ni articulos.
  iniciarLimpiezaPeriodica();

  // Vigilancia del espacio en disco: avisa con tiempo antes de que el volumen
  // de adjuntos se llene y arrastre a la base de datos con el.
  iniciarVigilanciaDisco();

  // Relleno unico del texto buscable de los articulos (ver el modulo).
  void rellenarBusquedaArticulos();
});

// Tiempo real sobre el mismo servidor HTTP: mismo puerto y misma cookie de
// sesion, sin abrir nada nuevo hacia afuera.
attachRealtime(server);

// Un error no atrapado no puede dejar el proceso en un estado indefinido sin
// que quede rastro: se registra y se cierra ordenado para que Docker lo
// levante de nuevo (restart: unless-stopped).
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Promesa rechazada sin manejar.');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Excepcion no atrapada: el proceso se reinicia.');
  stopRealtime();
  server.close(() => process.exit(1));
  // Si el cierre ordenado se traba, se fuerza la salida.
  setTimeout(() => process.exit(1), 5000).unref();
});

async function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando servidor...`);
  stopRealtime();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
