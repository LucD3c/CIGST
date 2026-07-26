import { z } from 'zod';

export const sectorStatusValues = ['Activo', 'Inactivo'] as const;

export const createSectorSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del sector es obligatorio.').max(100),
});

export const updateSectorSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del sector es obligatorio.').max(100).optional(),
  status: z.enum(sectorStatusValues).optional(),
});

export type CreateSectorInput = z.infer<typeof createSectorSchema>;
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;
