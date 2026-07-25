import { Router } from 'express';
import * as controller from './logbook.controller';
import { createLogbookEntrySchema, updateLogbookEntrySchema } from './logbook.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES, STAFF_ROLES } from '../../middleware/rbac.middleware';

export const logbookRouter = Router();

logbookRouter.use(requireAuth, requireRole(...STAFF_ROLES));

logbookRouter.get('/', controller.list);
logbookRouter.get('/:id', validate({ params: idParamSchema }), controller.getOne);
logbookRouter.post('/', validate({ body: createLogbookEntrySchema }), controller.create);
logbookRouter.patch('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema, body: updateLogbookEntrySchema }), controller.update);
logbookRouter.delete('/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.remove);
