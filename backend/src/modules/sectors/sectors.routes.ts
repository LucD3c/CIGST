import { Router } from 'express';
import * as controller from './sectors.controller';
import { createSectorSchema, updateSectorSchema } from './sectors.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';
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
