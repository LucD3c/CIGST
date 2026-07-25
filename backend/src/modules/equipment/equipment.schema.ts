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

export const equipmentStatusValues = ['Operativo', 'En reparación', 'Bloqueado', 'Baja'] as const;

export const createEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues),
  brand: optionalText(100),
  model: optionalText(100),
  serial: optionalText(100),
  asset: optionalText(100),
  employeeId: nullableUuid,
  location: optionalText(150),
  warranty: optionalText(100),
  notes: optionalText(2000),
});

export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  status: z.enum(equipmentStatusValues).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
