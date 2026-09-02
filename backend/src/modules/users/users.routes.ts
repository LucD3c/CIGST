import { Router } from 'express';
import * as controller from './users.controller';
import { createUserSchema, updateUserSchema } from './users.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { paginationQuerySchema } from '../../utils/pagination';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// Lista acotada (id + nombre) de quienes pueden tomar un ticket: la necesita
// cualquier rol de soporte para asignar tecnico, no solo el Administrador.
usersRouter.get('/technicians', requireRole(...STAFF_ROLES), controller.listTechnicians);

// Resto del panel administrador: exclusivo para Administradores.
usersRouter.use(requireRole(ROLES.ADMIN));

usersRouter.get('/', validate({ query: paginationQuerySchema }), controller.list);
usersRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
usersRouter.post('/', validate({ body: createUserSchema }), controller.create);
usersRouter.patch('/:id', validate({ params: idParamSchema, body: updateUserSchema }), controller.update);
usersRouter.delete('/:id', validate({ params: idParamSchema }), controller.remove);
