import { Router } from 'express';
import * as controller from './tickets.controller';
import { updateTicketSchema } from './tickets.schema';
import { idParamSchema, listQuerySchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

// Listado y detalle: cada rol ve su propio recorte (el service aplica el filtro
// segun quien pregunta), por eso no hay requireRole aca.
ticketsRouter.get('/', validate({ query: listQuerySchema }), controller.list);
ticketsRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);

// Alta: tanto soporte (a nombre de cualquier persona) como el propio empleado
// (autogestion). El controller valida el body con el schema segun el rol.
ticketsRouter.post('/', controller.create);

// Gestion (estado, prioridad, tecnico, solucion): exclusivo de soporte.
ticketsRouter.patch(
  '/:id',
  requireRole(...STAFF_ROLES),
  validate({ params: idParamSchema, body: updateTicketSchema }),
  controller.update,
);
ticketsRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
