import { Router } from 'express';
import * as controller from './schedules.controller';
import { createScheduleSchema, updateScheduleSchema } from './schedules.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

export const schedulesRouter = Router();

schedulesRouter.use(requireAuth);

// Igual que sectores: cualquier rol autenticado puede listarlos (los
// necesita para elegir turno al pedir soporte); crearlos, editarlos y
// borrarlos es exclusivo de Admin (Supervisor solo mira).
schedulesRouter.get('/', controller.list);
schedulesRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
schedulesRouter.post('/', requireRole(ROLES.ADMIN), validate({ body: createScheduleSchema }), controller.create);
schedulesRouter.patch(
  '/:id',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: updateScheduleSchema }),
  controller.update,
);
schedulesRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
