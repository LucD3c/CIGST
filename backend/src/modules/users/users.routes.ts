import { Router } from 'express';
import * as controller from './users.controller';
import { createUserSchema, updateUserSchema } from './users.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

export const usersRouter = Router();

// Panel administrador: exclusivo para Administradores.
usersRouter.use(requireAuth, requireRole(ROLES.ADMIN));

usersRouter.get('/', controller.list);
usersRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
usersRouter.post('/', validate({ body: createUserSchema }), controller.create);
usersRouter.patch('/:id', validate({ params: idParamSchema, body: updateUserSchema }), controller.update);
usersRouter.delete('/:id', validate({ params: idParamSchema }), controller.remove);
