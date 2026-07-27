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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración de entorno inválida:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
