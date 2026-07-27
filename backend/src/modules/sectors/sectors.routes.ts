import { Router } from 'express';
import * as controller from './sectors.controller';
import { z } from 'zod';
import { createSectorSchema, updateSectorSchema, createCategorySchema } from './sectors.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';

const categoryParamsSchema = z.object({
  id: z.string().uuid('El identificador del sector debe ser un UUID valido.'),
  categoryId: z.string().uuid('El identificador de la categoría debe ser un UUID valido.'),
});
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

export const sectorsRouter = Router();

sectorsRouter.use(requireAuth);

// Cualquier rol autenticado puede listarlos: un Empleado necesita esta lista
// para elegir su propio sector al pedir soporte.
sectorsRouter.get('/', validate({ query: listQuerySchema }), controller.list);
sectorsRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);

// Crear, editar y borrar sectores es exclusivo de Admin (regla de rangos:
// Supervisor ve el catalogo pero no lo toca).
sectorsRouter.post('/', requireRole(ROLES.ADMIN), validate({ body: createSectorSchema }), controller.create);
sectorsRouter.patch(
  '/:id',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: updateSectorSchema }),
  controller.update,
);
sectorsRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);

// Categorias de ticket del sector: las administra el Admin desde el detalle
// del sector, y despues aparecen como opciones al crear un ticket para ese
// sector (Supervisor/User las ven pero no las tocan).
sectorsRouter.post(
  '/:id/categories',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: createCategorySchema }),
  controller.addCategory,
);
sectorsRouter.delete(
  '/:id/categories/:categoryId',
  requireRole(ROLES.ADMIN),
  validate({ params: categoryParamsSchema }),
  controller.removeCategory,
);
