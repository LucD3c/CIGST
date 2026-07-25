import { z } from 'zod';
import { nullableUuid, optionalText } from '../../utils/commonSchemas';

export const ticketStatusValues = [
  'Nuevo',
  'Abierto',
  'En proceso',
  'Esperando usuario',
  'Esperando proveedor',
  'Resuelto',
  'Cerrado',
  'Cancelado',
] as const;

export const ticketPriorityValues = ['Baja', 'Media', 'Alta', 'Crítica'] as const;

export const ticketCategoryValues = [
  'Acceso / contraseña',
  'Aplicación / sistema',
  'Hardware',
  'Impresión',
  'Red / conectividad',
  'Telefonía',
  'Otro',
] as const;

export const ticketImpactValues = ['Individual', 'Sector completo', 'Atención a pacientes'] as const;

export const ticketContactValues = ['Interno telefónico', 'Teléfono móvil', 'Correo', 'Presencial'] as const;

const ticketSharedFields = {
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  description: z.string().trim().min(1, 'La descripción es obligatoria.').max(4000),
  equipmentId: nullableUuid,
  replacementId: nullableUuid,
  location: optionalText(150),
  contact: z.enum(ticketContactValues).optional(),
  availability: optionalText(150),
  supportShift: optionalText(150),
  category: z.enum(ticketCategoryValues),
  impact: z.enum(ticketImpactValues),
};

// Alta hecha por soporte: elige explicitamente a que persona corresponde el ticket.
export const createTicketByStaffSchema = z.object({
  ...ticketSharedFields,
  employeeId: z.string().uuid('Selecciona la persona a asistir.'),
  requestedById: nullableUuid,
  priority: z.enum(ticketPriorityValues).default('Media'),
});

// Autogestion: el empleado solo pide soporte para si mismo, no puede elegir a otra persona.
export const createTicketSelfServiceSchema = z.object(ticketSharedFields);

export const updateTicketSchema = z.object({
  status: z.enum(ticketStatusValues).optional(),
  priority: z.enum(ticketPriorityValues).optional(),
  technicianId: nullableUuid,
  solution: optionalText(4000),
  timeSpent: optionalText(50),
});

export type CreateTicketByStaffInput = z.infer<typeof createTicketByStaffSchema>;
export type CreateTicketSelfServiceInput = z.infer<typeof createTicketSelfServiceSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
