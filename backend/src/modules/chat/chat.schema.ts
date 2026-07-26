import { z } from 'zod';

const messageBody = z
  .string()
  .trim()
  .min(1, 'El mensaje no puede estar vacío.')
  .max(2000, 'El mensaje no puede superar los 2000 caracteres.');

export const startConversationSchema = z.object({
  recipientId: z.string().uuid('El destinatario debe ser un usuario válido.'),
  body: messageBody,
});

export const sendMessageSchema = z.object({
  body: messageBody,
});

export const listMessagesQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((data) => !(data.before && data.after), {
    message: 'No se puede combinar "before" y "after" en la misma consulta.',
  });

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
