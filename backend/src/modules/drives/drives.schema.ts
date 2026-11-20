import { z } from 'zod';

// Nombre de servidor o direccion IPv4. Se acota a proposito: sin esto se
// podrian colar cosas como "servidor:2222" o una URL entera.
const RE_HOST = /^[a-z0-9._-]{1,253}$/i;
// Nombre de recurso compartido: lo que Windows admite, sin separadores ni
// caracteres que alteren como se arma la direccion \\servidor\recurso.
const RE_RECURSO = /^[^\u0000-\u001f\u007f"\\/[\]:|<>+=;,*?]{1,80}$/;
// Una carpeta dentro del recurso: lo mismo que un nombre de archivo.
const RE_CARPETA = /^[^\u0000-\u001f\u007f"\\/:*?<>|]{1,255}$/;
const RE_DOMINIO = /^[a-z0-9._-]{1,64}$/i;
// El usuario no puede tener "%" (smbclient lo toma como separador de la
// contrasena), ni barras (el dominio va aparte), ni caracteres de control.
const RE_USUARIO = /^[^\u0000-\u001f\u007f%\\/"]{1,104}$/;

/**
 * Acepta la ruta como la copia cualquiera desde el Explorador de Windows:
 *   \\192.168.1.10\Contabilidad\2026
 *   //192.168.1.10/Contabilidad
 *   smb://servidor/Contabilidad
 * y la separa en servidor, recurso y subcarpeta.
 */
export const rutaUncSchema = z
  .string()
  .trim()
  .min(1, 'Falta la ruta de la carpeta compartida.')
  .max(1000)
  .transform((texto, ctx) => {
    const limpio = texto.replace(/^smb:/i, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const partes = limpio.split('/').filter(Boolean);
    const [host, share, ...base] = partes;
    if (!host || !share) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escribí la ruta completa, por ejemplo \\\\192.168.1.10\\Contabilidad' });
      return z.NEVER;
    }
    if (!RE_HOST.test(host)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El nombre o la IP del servidor solo puede tener letras, números, puntos y guiones.' });
      return z.NEVER;
    }
    if (!RE_RECURSO.test(share)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El nombre de la carpeta compartida tiene caracteres no válidos.' });
      return z.NEVER;
    }
    if (base.some((b) => !RE_CARPETA.test(b) || b === '.' || b === '..') || base.length > 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La subcarpeta tiene caracteres no válidos.' });
      return z.NEVER;
    }
    return { host, share, basePath: base.join('/') };
  });

/**
 * Usuario de la unidad. Si se escribe como DOMINIO\usuario (la forma en que se
 * suele ver en Windows), se separa solo.
 */
const usuarioSchema = z
  .string()
  .trim()
  .min(1, 'Falta el usuario de la unidad.')
  .max(200)
  .transform((texto) => {
    const corte = texto.indexOf('\\');
    if (corte > 0) return { usuario: texto.slice(corte + 1), dominio: texto.slice(0, corte) };
    return { usuario: texto, dominio: null as string | null };
  })
  .refine((u) => RE_USUARIO.test(u.usuario), { message: 'El usuario tiene caracteres no válidos (no puede tener % ni barras).' })
  .refine((u) => u.dominio === null || RE_DOMINIO.test(u.dominio), { message: 'El dominio tiene caracteres no válidos.' });

const dominioSchema = z
  .string()
  .trim()
  .max(64)
  .refine((d) => d === '' || RE_DOMINIO.test(d), { message: 'El dominio o grupo de trabajo solo puede tener letras, números, puntos y guiones.' });

export const createDriveSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre para reconocer la unidad.').max(120),
  ruta: rutaUncSchema,
  domain: dominioSchema.optional().default(''),
  authUser: usuarioSchema,
  password: z.string().min(1, 'Falta la contraseña de la unidad.').max(500),
});

export const updateDriveSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ruta: rutaUncSchema.optional(),
  domain: dominioSchema.optional(),
  authUser: usuarioSchema.optional(),
  password: z.string().min(1).max(500).optional(),
  status: z.enum(['Activo', 'Inactivo']).optional(),
});

export const grantDriveAccessSchema = z
  .object({
    userId: z.string().uuid().nullable().optional(),
    sectorId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => [d.userId, d.sectorId].filter(Boolean).length === 1, {
    message: 'Elegí exactamente uno: una persona o un sector.',
  });

const ruta = z.string().max(1024).optional().default('');

export const listItemsQuerySchema = z.object({ path: ruta });
export const fileQuerySchema = z.object({ path: z.string().min(1, 'Falta el archivo.').max(1024) });
export const uploadQuerySchema = z.object({
  path: ruta,
  name: z.string().min(1, 'Falta el nombre del archivo.').max(255),
});
export const existsQuerySchema = uploadQuerySchema;

export const deleteFileSchema = z.object({
  path: z.string().min(1, 'Falta el archivo.').max(1024),
  password: z.string().min(1, 'Escribí la contraseña de la unidad para confirmar.').max(500),
});

export type CreateDriveInput = z.infer<typeof createDriveSchema>;
export type UpdateDriveInput = z.infer<typeof updateDriveSchema>;
