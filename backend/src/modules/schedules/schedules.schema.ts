import { z } from 'zod';

export const scheduleStatusValues = ['Activo', 'Inactivo'] as const;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeField = z.string().trim().regex(timePattern, 'Usá el formato HH:MM (24 horas).');

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del turno es obligatorio.').max(100),
  startTime: timeField,
  endTime: timeField,
});

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del turno es obligatorio.').max(100).optional(),
  startTime: timeField.optional(),
  endTime: timeField.optional(),
  status: z.enum(scheduleStatusValues).optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
