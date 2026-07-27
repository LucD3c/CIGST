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

// La categoria dejo de ser una lista fija: cada sector define las suyas
// desde su propia pantalla (ver TicketCategory). El ticket guarda el NOMBRE
// como texto, asi borrar una categoria no altera el historial ya cargado.
export const DEFAULT_CATEGORY = 'General';

// "Impacto" se unificó con "Prioridad": quien pide ayuda no siempre sabe (ni
// tiene tiempo de averiguar) si el problema afecta a todo el sector o solo a
// su equipo; la prioridad ya captura la urgencia igual de bien y en un solo
// campo. "Reemplazo durante la atención" se eliminó: con sector en vez de
// persona, ese dato ya no aporta nada (el sector entero queda cubierto).
// "Canal de contacto" y "Horario disponible" tambien se eliminaron: le hacian
// perder tiempo a quien pide soporte sin aportar nada que el sistema no
// supiera ya (la hora queda registrada sola al crear el ticket).
const ticketSharedFields = {
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  description: z.string().trim().min(1, 'La descripción es obligatoria.').max(4000),
  equipmentId: nullableUuid,
  sectorId: nullableUuid,
  scheduleId: nullableUuid,
  category: z.string().trim().max(80).optional(),
  priority: z.enum(ticketPriorityValues).optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
};

// Alta unificada: cualquier rol puede crear un ticket para cualquier persona
// de la empresa (regla de rangos). Si no se indica persona, se usa la propia
// (el service la resuelve y valida).
export const createTicketSchema = z.object({
  ...ticketSharedFields,
  employeeId: nullableUuid,
  requestedById: nullableUuid,
});

export const updateTicketSchema = z.object({
  status: z.enum(ticketStatusValues).optional(),
  priority: z.enum(ticketPriorityValues).optional(),
  technicianId: nullableUuid,
  solution: optionalText(4000),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
