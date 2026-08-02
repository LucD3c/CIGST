import { Router } from 'express';
import { z } from 'zod';
import * as controller from './feed.controller';
import { createPostSchema, updatePostSchema, listPostsSchema, createCommentSchema } from './feed.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

const commentParamsSchema = z.object({
  id: z.string().uuid('El identificador de la publicación debe ser un UUID valido.'),
  commentId: z.string().uuid('El identificador del comentario debe ser un UUID valido.'),
});

export const feedRouter = Router();

feedRouter.use(requireAuth);

// Leer el feed, comentar y reaccionar: cualquier rango. Es el tablero de
// novedades de toda la empresa, no una herramienta de soporte.
// Cada endpoint filtra ademas por destinatario dentro del service: aca no
// alcanza con el rol, hay que ser destinatario de la publicacion.
feedRouter.get('/', validate({ query: listPostsSchema }), controller.list);
feedRouter.get('/unseen-count', controller.unseenCount);
feedRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
feedRouter.get('/:id/comments', validate({ params: idParamSchema }), controller.listComments);
feedRouter.get('/:id/viewers', validate({ params: idParamSchema }), controller.listViewers);
feedRouter.post('/:id/view', validate({ params: idParamSchema }), controller.markViewed);
feedRouter.post('/:id/reaction', validate({ params: idParamSchema }), controller.toggleReaction);
feedRouter.post(
  '/:id/comments',
  validate({ params: idParamSchema, body: createCommentSchema }),
  controller.addComment,
);
feedRouter.delete('/:id/comments/:commentId', validate({ params: commentParamsSchema }), controller.removeComment);

// Publicar es de Administrador y Supervisor. El service ademas exige ser el
// autor (o Administrador) para editar y borrar.
feedRouter.post(
  '/',
  requireRole(ROLES.ADMIN, ROLES.SUPERVISOR),
  validate({ body: createPostSchema }),
  controller.create,
);
feedRouter.patch(
  '/:id',
  requireRole(ROLES.ADMIN, ROLES.SUPERVISOR),
  validate({ params: idParamSchema, body: updatePostSchema }),
  controller.update,
);
feedRouter.delete(
  '/:id',
  requireRole(ROLES.ADMIN, ROLES.SUPERVISOR),
  validate({ params: idParamSchema }),
  controller.remove,
);
