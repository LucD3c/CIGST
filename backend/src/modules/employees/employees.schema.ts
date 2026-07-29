import { z } from 'zod';
import { nullableUuid, optionalText } from '../../utils/commonSchemas';

export const employeeStatusValues = ['Activo', 'Inactivo'] as const;

// Hora HH:MM (24 h) opcional: el campo puede venir vacio (sin horario).
const optionalTime = () =>
  z
    .union([z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usá el formato HH:MM (24 horas).'), z.literal('')])
    .optional()
    .transform((v) => (v === '' ? null : v));

export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  document: optionalText(50),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
  phone: optionalText(50),
  extension: optionalText(20),
  sectorId: nullableUuid,
  position: optionalText(100),
  workShift: optionalText(50),
  // Horario laboral en formato HH:MM (24 h). Con esto la plataforma calcula
  // sola si la persona esta en su horario ahora mismo.
  workStartTime: optionalTime(),
  workEndTime: optionalTime(),
  schedule: optionalText(100),
  replacementId: nullableUuid,
  notes: optionalText(2000),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(employeeStatusValues).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
