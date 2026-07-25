import { z } from 'zod';
import { nullableUuid } from '../../utils/commonSchemas';

export const logbookCategoryValues = ['Mantenimiento', 'Infraestructura', 'Seguridad', 'Cambio', 'Actualización'] as const;

export const createLogbookEntrySchema = z.object({
  title: z.string().trim().min(1, 'El titulo es obligatorio.').max(200),
  category: z.enum(logbookCategoryValues),
  detail: z.string().trim().min(1, 'El detalle es obligatorio.').max(4000),
  relatedTicketId: nullableUuid,
  relatedEquipmentId: nullableUuid,
});

export const updateLogbookEntrySchema = createLogbookEntrySchema.partial();

export type CreateLogbookEntryInput = z.infer<typeof createLogbookEntrySchema>;
export type UpdateLogbookEntryInput = z.infer<typeof updateLogbookEntrySchema>;
