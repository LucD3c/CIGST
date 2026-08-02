import { Router } from 'express';
import { z } from 'zod';
import * as controller from './knowledge.controller';
import {
  createSpaceSchema,
  updateSpaceSchema,
  createSectionSchema,
  updateSectionSchema,
  createArticleSchema,
  updateArticleSchema,
  createPermissionSchema,
  searchSchema,
} from './knowledge.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';

const uuid = (que: string) => z.string().uuid(`El identificador ${que} debe ser un UUID valido.`);
const sectionParams = z.object({ sectionId: uuid('de la sección') });
const articleParams = z.object({ articleId: uuid('del artículo') });
const permissionParams = z.object({ id: uuid('de la base'), permissionId: uuid('del permiso') });
const spaceSectionParams = z.object({ id: uuid('de la base') });

export const knowledgeRouter = Router();

knowledgeRouter.use(requireAuth);

// Todo el control de acceso de esta seccion vive en el service
// (knowledge.permissions.ts), no en el router: quien puede ver o editar una
// base depende de los permisos que se le cargaron a ESA base, no del rango.
// Por eso aca no hay requireRole salvo donde el rango es la regla completa.

knowledgeRouter.get('/search', validate({ query: searchSchema }), controller.search);

knowledgeRouter.get('/spaces', controller.listSpaces);
knowledgeRouter.post('/spaces', validate({ body: createSpaceSchema }), controller.createSpace);
knowledgeRouter.get('/spaces/:id', validate({ params: idParamSchema }), controller.getSpace);
knowledgeRouter.patch(
  '/spaces/:id',
  validate({ params: idParamSchema, body: updateSpaceSchema }),
  controller.updateSpace,
);
knowledgeRouter.delete('/spaces/:id', validate({ params: idParamSchema }), controller.removeSpace);

knowledgeRouter.post(
  '/spaces/:id/sections',
  validate({ params: spaceSectionParams, body: createSectionSchema }),
  controller.createSection,
);
knowledgeRouter.patch(
  '/sections/:sectionId',
  validate({ params: sectionParams, body: updateSectionSchema }),
  controller.updateSection,
);
knowledgeRouter.delete('/sections/:sectionId', validate({ params: sectionParams }), controller.removeSection);

knowledgeRouter.post('/articles', validate({ body: createArticleSchema }), controller.createArticle);
knowledgeRouter.get('/articles/:articleId', validate({ params: articleParams }), controller.getArticle);
knowledgeRouter.patch(
  '/articles/:articleId',
  validate({ params: articleParams, body: updateArticleSchema }),
  controller.updateArticle,
);
knowledgeRouter.delete('/articles/:articleId', validate({ params: articleParams }), controller.removeArticle);

knowledgeRouter.get('/spaces/:id/permissions', validate({ params: idParamSchema }), controller.listPermissions);
knowledgeRouter.post(
  '/spaces/:id/permissions',
  validate({ params: idParamSchema, body: createPermissionSchema }),
  controller.addPermission,
);
knowledgeRouter.delete(
  '/spaces/:id/permissions/:permissionId',
  validate({ params: permissionParams }),
  controller.removePermission,
);
