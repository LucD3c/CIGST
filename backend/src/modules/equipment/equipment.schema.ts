import { z } from 'zod';
import { nullableUuid } from '../../utils/commonSchemas';

// "Equipos y espacios": no es solo inventario informatico. Un ticket puede
// apuntar a un equipo (una PC, una impresora) o a un LUGAR (un consultorio,
// una sala, una puerta) -- cualquier cosa sobre la que se pida ayuda. Por eso
// la lista incluye tipos de espacio y un "Otro" para lo que no encaje: la
// idea es cargar solo lo que realmente recibe pedidos, no un inventario
// exhaustivo de cada objeto de la empresa.
export const equipmentTypeValues = [
  // Equipos
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
  // Espacios y lugares
  'Consultorio',
  'Oficina',
  'Sala',
  'Depósito',
  'Puerta',
  'Instalación',
  'Otro',
] as const;

export const equipmentStatusValues = ['Activo', 'Inactivo'] as const;

// Formulario reducido a lo indispensable: tipo, un nombre/modelo que lo
// identifique y el sector donde vive. El historial de "Cambios" (changeLog)
// lo escribe solo el backend en cada edicion: el cliente no lo manda nunca.
export const createEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues),
  // Sirve tanto para un modelo ("Dell OptiPlex") como para identificar un
  // lugar ("Consultorio 213", "Sala de espera").
  model: z.string().trim().min(1, 'Escribí un nombre o identificación (por ejemplo "Consultorio 213").').max(150),
  sectorId: nullableUuid,
});

export const updateEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues).optional(),
  model: z.string().trim().min(1, 'Escribí un nombre o identificación.').max(150).optional(),
  sectorId: nullableUuid,
  status: z.enum(equipmentStatusValues).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
