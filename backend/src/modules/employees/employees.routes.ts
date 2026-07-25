import { Router } from 'express';
import * as controller from './employees.controller';
import { createEmployeeSchema, updateEmployeeSchema } from './employees.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const employeesRouter = Router();

employeesRouter.use(requireAuth, requireRole(...STAFF_ROLES));

employeesRouter.get('/', validate({ query: listQuerySchema }), controller.list);
employeesRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
employeesRouter.post('/', validate({ body: createEmployeeSchema }), controller.create);
employeesRouter.patch('/:id', validate({ params: idParamSchema, body: updateEmployeeSchema }), controller.update);
employeesRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
