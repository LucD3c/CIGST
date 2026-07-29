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

// Referencia opcional a otro registro (sector, equipo, persona de reemplazo…).
// Se acepta de las tres formas en que puede llegar "sin valor": el '' que manda
// un desplegable vacio del formulario, el null explicito de quien usa la API
// directamente, y la ausencia del campo. Las tres se guardan como null.
export const nullableUuid = z
  .union([z.string().uuid(), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));
