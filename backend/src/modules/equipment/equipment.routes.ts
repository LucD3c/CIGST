import { Router } from 'express';
import * as controller from './equipment.controller';
import { createEquipmentSchema, updateEquipmentSchema } from './equipment.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const equipmentRouter = Router();

equipmentRouter.use(requireAuth, requireRole(...STAFF_ROLES));

// Supervisor VE el inventario; crear, editar y borrar es exclusivo de Admin
// (regla de rangos: Supervisor no crea ni edita catalogos).
equipmentRouter.get('/', validate({ query: listQuerySchema }), controller.list);
equipmentRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
equipmentRouter.post('/', requireRole(ROLES.ADMIN), validate({ body: createEquipmentSchema }), controller.create);
equipmentRouter.patch('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema, body: updateEquipmentSchema }), controller.update);
equipmentRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
