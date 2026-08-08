import { z } from 'zod';
import { PUERTOS_IMAP, PUERTOS_SMTP } from './mail.network';

const host = z
  .string()
  .trim()
  .min(1, 'Falta el servidor.')
  .max(255)
  // Nombre de dominio o direccion IP. Se acota a proposito: sin esto se
  // podrian colar cosas como "servidor:2222/algo" o una URL entera.
  .regex(/^[a-z0-9.:_-]+$/i, 'El servidor solo puede tener letras, números, puntos y guiones.');

const puerto = (permitidos: number[]) =>
  z.coerce
    .number()
    .int()
    .refine((p) => permitidos.includes(p), {
      message: `Puerto no permitido. Los válidos son: ${permitidos.join(', ')}.`,
    });

export const createProviderSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre para reconocerlo.').max(120),
  imapHost: host,
  imapPort: puerto(PUERTOS_IMAP),
  imapSecure: z.boolean().default(true),
  smtpHost: host,
  smtpPort: puerto(PUERTOS_SMTP),
  smtpSecurity: z.enum(['ssl', 'starttls', 'ninguno']).default('starttls'),
  allowInternal: z.boolean().default(false),
});

export const updateProviderSchema = createProviderSchema.partial().extend({
  status: z.enum(['Activo', 'Inactivo']).optional(),
});

export const createAccountSchema = z.object({
  providerId: z.string().uuid('Elegí un proveedor.'),
  email: z.string().trim().email('Escribí una dirección de correo válida.').max(200),
  displayName: z.string().trim().max(120).optional().default(''),
  authUser: z.string().trim().max(200).optional().default(''),
  password: z.string().min(1, 'Falta la contraseña de la casilla.').max(500),
  // Solo un Administrador puede crear una casilla compartida. El service lo
  // vuelve a comprobar: aca es apenas la forma del dato.
  shared: z.boolean().default(false),
});

export const updateAccountSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  authUser: z.string().trim().max(200).optional(),
  password: z.string().min(1).max(500).optional(),
  status: z.enum(['Activo', 'Inactivo']).optional(),
});

export const grantAccessSchema = z
  .object({
    userId: z.string().uuid().nullable().optional(),
    sectorId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => [d.userId, d.sectorId].filter(Boolean).length === 1, {
    message: 'Elegí exactamente uno: una persona o un sector.',
  });

export const listMessagesSchema = z.object({
  folder: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  q: z.string().trim().max(200).optional(),
});

export const sendMessageSchema = z.object({
  to: z.string().trim().min(1, 'Falta el destinatario.').max(2000),
  cc: z.string().trim().max(2000).optional().default(''),
  bcc: z.string().trim().max(2000).optional().default(''),
  subject: z.string().trim().max(500).optional().default(''),
  body: z.string().max(200000).optional().default(''),
  attachmentIds: z.array(z.string().uuid()).max(5).optional().default([]),
  // Para que el correo quede enganchado a la conversacion en el cliente de
  // quien lo recibe cuando es una respuesta.
  inReplyTo: z.string().trim().max(500).optional(),
  references: z.string().trim().max(2000).optional(),
});

export const messageActionSchema = z.object({
  folder: z.string().trim().min(1).max(200),
  uid: z.coerce.number().int().positive(),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
