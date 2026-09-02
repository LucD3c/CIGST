import { Router } from 'express';
import * as controller from './logbook.controller';
import { createLogbookEntrySchema, updateLogbookEntrySchema } from './logbook.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { paginationQuerySchema } from '../../utils/pagination';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

export const logbookRouter = Router();

// Bitacora tecnica: exclusiva de Administrador (Supervisor ya no la ve).
logbookRouter.use(requireAuth, requireRole(ROLES.ADMIN));

logbookRouter.get('/', validate({ query: paginationQuerySchema }), controller.list);
logbookRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
logbookRouter.post('/', validate({ body: createLogbookEntrySchema }), controller.create);
logbookRouter.patch('/:id', validate({ params: idParamSchema, body: updateLogbookEntrySchema }), controller.update);
logbookRouter.delete('/:id', validate({ params: idParamSchema }), controller.remove);
