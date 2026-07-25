import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('El identificador debe ser un UUID valido.'),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});

// Convierte '' a null/undefined y recorta espacios; util para campos de texto
// opcionales que llegan desde formularios.
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const nullableUuid = z
  .union([z.string().uuid(), z.literal('')])
  .optional()
  .transform((value) => (value ? value : null));
