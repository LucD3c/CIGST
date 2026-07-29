import { z } from 'zod';

// El cuerpo puede ir vacio si el mensaje lleva al menos un adjunto (mandar
// solo una imagen o un PDF es un caso normal en un chat).
const messageBody = z.string().trim().max(2000, 'El mensaje no puede superar los 2000 caracteres.');
const attachmentIds = z.array(z.string().uuid()).max(5).optional();

const requireBodyOrAttachment = (data: { body: string; attachmentIds?: string[] }) =>
  data.body.length > 0 || Boolean(data.attachmentIds?.length);
const emptyMessageError = { message: 'Escribí un mensaje o adjuntá un archivo.', path: ['body'] };

export const startConversationSchema = z
  .object({
    recipientId: z.string().uuid('El destinatario debe ser un usuario válido.'),
    body: messageBody,
    attachmentIds,
  })
  .refine(requireBodyOrAttachment, emptyMessageError);

export const sendMessageSchema = z
  .object({
    body: messageBody,
    attachmentIds,
  })
  .refine(requireBodyOrAttachment, emptyMessageError);

export const listMessagesQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  });

const groupName = z.string().trim().min(1, 'El nombre del grupo es obligatorio.').max(80);
const memberIds = z.array(z.string().uuid()).max(200);

export const createGroupSchema = z.object({
  name: groupName,
  memberIds,
});

export const updateGroupSchema = z.object({
  name: groupName.optional(),
  memberIds: memberIds.optional(),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
