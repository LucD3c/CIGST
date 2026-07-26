import { z } from 'zod';
import { nullableUuid, optionalText } from '../../utils/commonSchemas';

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
// identifique, el sector donde vive y notas opcionales. Nada de fabricante,
// numero de serie ni activo fijo: quien carga un ticket sobre este equipo no
// tiene por que conocer esos datos.
export const createEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues),
  model: z.string().trim().min(1, 'Escribí un modelo o nombre que lo identifique.').max(150),
  sectorId: nullableUuid,
  notes: optionalText(2000),
});

export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  status: z.enum(equipmentStatusValues).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
