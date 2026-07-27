import { z } from 'zod';
import { nullableUuid } from '../../utils/commonSchemas';

export const equipmentTypeValues = [
  'PC',
  'Notebook',
  'Monitor',
  'Teclado',
  'Mouse',
  'Scanner',
  'Impresora',
  'UPS',
  'Teléfono IP',
  'Lector',
  'Otro',
] as const;

export const equipmentStatusValues = ['Activo', 'Inactivo'] as const;

// Formulario reducido a lo indispensable: tipo, un nombre/modelo que lo
// identifique y el sector donde vive. El historial de "Cambios" (changeLog)
// lo escribe solo el backend en cada edicion: el cliente no lo manda nunca.
export const createEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues),
  model: z.string().trim().min(1, 'Escribí un modelo o nombre que lo identifique.').max(150),
  sectorId: nullableUuid,
});

export const updateEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues).optional(),
  model: z.string().trim().min(1, 'Escribí un modelo o nombre que lo identifique.').max(150).optional(),
  sectorId: nullableUuid,
  status: z.enum(equipmentStatusValues).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
