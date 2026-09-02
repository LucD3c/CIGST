import { Router } from 'express';
import * as controller from './employees.controller';
import { createEmployeeSchema, updateEmployeeSchema } from './employees.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';
import { paginationQuerySchema } from '../../utils/pagination';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const employeesRouter = Router();

employeesRouter.use(requireAuth, requireRole(...STAFF_ROLES));

// Supervisor VE las fichas; crear, editar y borrar es exclusivo de Admin
// (regla de rangos: Supervisor no crea ni edita catalogos).
employeesRouter.get('/', validate({ query: paginationQuerySchema }), controller.list);
employeesRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
employeesRouter.post('/', requireRole(ROLES.ADMIN), validate({ body: createEmployeeSchema }), controller.create);
employeesRouter.patch('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema, body: updateEmployeeSchema }), controller.update);
employeesRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
