import { Router } from 'express';
import * as controller from './notifications.controller';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';

export const notificationsRouter = Router();

// Cada usuario ve y administra solo SUS notificaciones (el repositorio filtra
// por userId en cada consulta, incluida la de marcar como leida).
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', controller.list);
notificationsRouter.get('/unread-count', controller.unreadCount);
notificationsRouter.post('/read-all', controller.markAllRead);
notificationsRouter.post('/:id/read', validate({ params: idParamSchema }), controller.markRead);
