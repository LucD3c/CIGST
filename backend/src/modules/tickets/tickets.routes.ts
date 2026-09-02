import { Router } from 'express';
import * as controller from './tickets.controller';
import { createTicketSchema, updateTicketSchema } from './tickets.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { paginationQuerySchema } from '../../utils/pagination';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

// Opciones del formulario de ticket (personas/equipos/sectores/turnos
// activos): las necesita cualquier rol para crear un ticket. Va ANTES de
// /:id para que "form-options" no se interprete como un id.
ticketsRouter.get('/form-options', controller.formOptions);

// Listado y detalle: cada rol ve su propio recorte (el service aplica el filtro
// segun quien pregunta), por eso no hay requireRole aca.
ticketsRouter.get('/', validate({ query: paginationQuerySchema }), controller.list);
ticketsRouter.get('/stats', controller.stats);
ticketsRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);

// Alta: cualquier rol, para cualquier persona (regla de rangos).
ticketsRouter.post('/', validate({ body: createTicketSchema }), controller.create);

// Gestion (estado, prioridad, tecnico, solucion): exclusivo de soporte.
ticketsRouter.patch(
  '/:id',
  requireRole(...STAFF_ROLES),
  validate({ params: idParamSchema, body: updateTicketSchema }),
  controller.update,
);
ticketsRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
