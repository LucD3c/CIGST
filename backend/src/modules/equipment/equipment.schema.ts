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
// Codigo identificatorio del equipo o espacio.
//
// Antes lo generaba siempre la plataforma (EQ-001, EQ-002...) y no se podia
// cambiar. Ahora se puede escribir el propio: muchas empresas ya tienen sus
// etiquetas de inventario pegadas en las maquinas ("PC-RECEP-04", "IMP-2B") y
// obligarlas a convivir con dos numeraciones distintas es pedirles que se
// equivoquen. Si se deja vacio, la plataforma sigue generando uno sola.
//
// Se admiten letras, numeros, guiones, guiones bajos, puntos, barras y
// espacios: alcanza para cualquier convencion de inventario razonable y deja
// afuera cualquier cosa rara.
const codigoPattern = /^[A-Za-z0-9._/\- ]+$/;

export const codigoEquipoSchema = z
  .string()
  .trim()
  .min(2, 'El código tiene que tener al menos 2 caracteres.')
  .max(40, 'El código no puede superar los 40 caracteres.')
  .regex(codigoPattern, 'El código admite letras, números, espacios y los signos . _ - /')
  .transform((v) => v.replace(/\s+/g, ' '));

export const createEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues),
  // Sirve tanto para un modelo ("Dell OptiPlex") como para identificar un
  // lugar ("Consultorio 213", "Sala de espera").
  model: z.string().trim().min(1, 'Escribí un nombre o identificación (por ejemplo "Consultorio 213").').max(150),
  // Opcional: si no viene, lo genera la plataforma.
  code: z.union([codigoEquipoSchema, z.literal(''), z.null()]).optional(),
  sectorId: nullableUuid,
});

export const updateEquipmentSchema = z.object({
  type: z.enum(equipmentTypeValues).optional(),
  model: z.string().trim().min(1, 'Escribí un nombre o identificación.').max(150).optional(),
  // En la edicion el codigo tambien se puede cambiar, pero no se puede dejar
  // vacio: un equipo ya creado siempre tiene que tener uno.
  code: codigoEquipoSchema.optional(),
  sectorId: nullableUuid,
  status: z.enum(equipmentStatusValues).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
