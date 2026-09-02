import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  SESSION_COOKIE_NAME: z.string().min(1).default('cigst_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() === 'true'),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  STATIC_DIR: z.string().default('public'),
  // Carpeta donde se guardan los adjuntos (montada como volumen de Docker,
  // por eso es escribible aunque el resto del contenedor sea de solo lectura).
  UPLOADS_DIR: z.string().default('uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Retencion de datos ------------------------------------------------
  // Solo alcanza a datos QUE NO LE SIRVEN A NADIE: sesiones vencidas (tokens
  // muertos), intentos de login viejos y avisos ya leidos. Nunca toca tickets,
  // mensajes, adjuntos en uso, personas, equipos ni articulos: ni siquiera los
  // dados de baja, que se conservan para siempre.
  RETENTION_NOTIF_LEIDAS_DIAS: z.coerce.number().int().min(7).default(90),
  RETENTION_NOTIF_SIN_LEER_DIAS: z.coerce.number().int().min(30).default(365),

  // --- Control de disco --------------------------------------------------
  // Tope para la carpeta de adjuntos. Comparte disco con la base de datos: si
  // se llenara, Postgres dejaria de poder escribir y se caeria la plataforma
  // entera. Por eso se frena ANTES de llegar a ese punto.
  UPLOADS_MAX_GB: z.coerce.number().positive().default(20),
  UPLOADS_AVISO_PORCENTAJE: z.coerce.number().int().min(50).max(99).default(80),
  // Margen libre que se exige en el disco fisico, ademas del tope de arriba.
  DISCO_MINIMO_LIBRE_MB: z.coerce.number().int().positive().default(1024),

  // --- Compresion de imagenes en el servidor -----------------------------
  IMAGEN_MAX_LADO: z.coerce.number().int().min(400).default(1600),
  IMAGEN_CALIDAD: z.coerce.number().min(0.3).max(1).default(0.82),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración de entorno inválida:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// --- Controles de arranque ---------------------------------------------------
// Se ejecutan una sola vez, al levantar. La idea es que una instalacion mal
// configurada se note ACA, con un mensaje claro, y no meses despues.

const PLACEHOLDERS = ['cambiar-esta-contrasena', 'cambiar-esta-contraseña', 'changeme', 'password', 'postgres'];

function claveDeLaUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).password) || null;
  } catch {
    return null;
  }
}

const clavePg = claveDeLaUrl(env.DATABASE_URL);

// Arrancar en produccion con la contrasena de ejemplo dejaria la base abierta a
// cualquiera que haya leido el repositorio. Se corta el arranque a proposito.
if (env.NODE_ENV === 'production' && clavePg && PLACEHOLDERS.includes(clavePg.toLowerCase())) {
  console.error(
    '\n[CIGST] La contraseña de la base de datos es todavía la de ejemplo.\n' +
      '        Cambiá POSTGRES_PASSWORD en el archivo .env por una contraseña propia\n' +
      '        (el instalador puede generarte una) y volvé a levantar la plataforma.\n',
  );
  process.exit(1);
}

if (env.NODE_ENV === 'production' && clavePg && clavePg.length < 12) {
  console.warn('[CIGST] La contraseña de la base de datos es corta (menos de 12 caracteres). Conviene reemplazarla.');
}

// Sin HTTPS la cookie de sesion viaja legible por la red. No se corta el
// arranque porque en una LAN chica es una decision valida, pero queda avisado
// en el registro para que no pase inadvertido.
if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  console.warn(
    '[CIGST] COOKIE_SECURE=false: la plataforma trabaja sobre HTTP y las credenciales viajan sin cifrar por la red. ' +
      'Para usar HTTPS seguí docs/deployment-empresa.md y poné COOKIE_SECURE=true.',
  );
}
