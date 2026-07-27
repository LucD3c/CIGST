import { z } from 'zod';

export const sectorStatusValues = ['Activo', 'Inactivo'] as const;

export const createSectorSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del sector es obligatorio.').max(100),
});

export const updateSectorSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del sector es obligatorio.').max(100).optional(),
  status: z.enum(sectorStatusValues).optional(),
});

// Categorias de ticket propias de cada sector: las define quien administra
// ("Hardware" para Sistemas, "Arreglar" para Mantenimiento, etc.).
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la categoría es obligatorio.').max(80),
});

export type CreateSectorInput = z.infer<typeof createSectorSchema>;
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
