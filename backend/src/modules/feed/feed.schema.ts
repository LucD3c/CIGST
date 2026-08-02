import { z } from 'zod';
import { blocksSchema } from '../../utils/contentBlocks';

export const MAX_COMMENT = 1500;

const audiencia = z
  .object({
    audience: z.enum(['todos', 'sectores']).default('todos'),
    sectorIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((d) => d.audience !== 'sectores' || d.sectorIds.length > 0, {
    message: 'Elegí al menos un sector, o publicá para todos.',
    path: ['sectorIds'],
  });

export const createPostSchema = z
  .object({
    title: z.string().trim().min(1, 'Poné un título.').max(200),
    blocks: blocksSchema.min(1, 'La publicación necesita al menos un bloque de contenido.'),
    pinned: z.boolean().default(false),
  })
  .and(audiencia);

export const updatePostSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    blocks: blocksSchema.min(1).optional(),
    pinned: z.boolean().optional(),
    audience: z.enum(['todos', 'sectores']).optional(),
    sectorIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((d) => d.audience !== 'sectores' || (d.sectorIds?.length ?? 0) > 0, {
    message: 'Elegí al menos un sector, o publicá para todos.',
    path: ['sectorIds'],
  });

export const listPostsSchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  q: z.string().trim().max(200).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Escribí un comentario.').max(MAX_COMMENT),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
