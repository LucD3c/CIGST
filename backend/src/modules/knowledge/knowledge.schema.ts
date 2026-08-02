import { z } from 'zod';
import { blocksSchema } from '../../utils/contentBlocks';
import { ROLES } from '../../middleware/rbac.middleware';

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre para la base.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  icon: z.string().trim().max(8).optional().default('📘'),
});

export const updateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).optional(),
  icon: z.string().trim().max(8).optional(),
  status: z.enum(['Activo', 'Inactivo']).optional(),
});

export const createSectionSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre para la sección.').max(120),
});

export const updateSectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  position: z.number().int().min(0).max(999).optional(),
});

export const createArticleSchema = z.object({
  sectionId: z.string().uuid('Elegí una sección.'),
  title: z.string().trim().min(1, 'Poné un título para el artículo.').max(200),
  blocks: blocksSchema.default([]),
});

export const updateArticleSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  sectionId: z.string().uuid().optional(),
  position: z.number().int().min(0).max(999).optional(),
  blocks: blocksSchema.optional(),
});

// Un permiso apunta a UNA sola cosa. El `refine` lo obliga: sin esto se podria
// guardar un permiso ambiguo (por ejemplo sector + usuario a la vez) y la
// resolucion quedaria abierta a interpretacion.
export const createPermissionSchema = z
  .object({
    level: z.enum(['lectura', 'edicion']),
    sectorId: z.string().uuid().nullable().optional(),
    role: z.enum([ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.USER]).nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) => [d.sectorId, d.role, d.userId].filter(Boolean).length === 1,
    { message: 'Elegí exactamente un destinatario: un sector, un rango o una persona.' },
  );

export const searchSchema = z.object({
  q: z.string().trim().min(2, 'Escribí al menos 2 caracteres.').max(200),
});

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
