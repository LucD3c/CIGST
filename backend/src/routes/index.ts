import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { employeesRouter } from '../modules/employees/employees.routes';
import { equipmentRouter } from '../modules/equipment/equipment.routes';
import { ticketsRouter } from '../modules/tickets/tickets.routes';
import { logbookRouter } from '../modules/logbook/logbook.routes';
import { sectorsRouter } from '../modules/sectors/sectors.routes';
import { schedulesRouter } from '../modules/schedules/schedules.routes';
import { chatRouter } from '../modules/chat/chat.routes';
import { notificationsRouter } from '../modules/notifications/notifications.routes';
import { apiRateLimiter } from '../middleware/rateLimit.middleware';

export const apiRouter = Router();

// /health no lleva limite: lo pega el healthcheck de Docker cada 30s, de por
// vida del contenedor, y nunca hay motivo para bloquearlo.
apiRouter.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Red de contencion general para el resto de /api (ver el comentario en
// rateLimit.middleware.ts). Los endpoints mas sensibles (login, chat) tienen
// ademas su propio limite mas estricto, aplicado en sus propias rutas.
apiRouter.use(apiRateLimiter);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/equipment', equipmentRouter);
apiRouter.use('/tickets', ticketsRouter);
apiRouter.use('/logbook', logbookRouter);
apiRouter.use('/sectors', sectorsRouter);
apiRouter.use('/schedules', schedulesRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/notifications', notificationsRouter);
