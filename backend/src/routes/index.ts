import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { employeesRouter } from '../modules/employees/employees.routes';
import { equipmentRouter } from '../modules/equipment/equipment.routes';
import { ticketsRouter } from '../modules/tickets/tickets.routes';
import { logbookRouter } from '../modules/logbook/logbook.routes';
import { sectorsRouter } from '../modules/sectors/sectors.routes';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/equipment', equipmentRouter);
apiRouter.use('/tickets', ticketsRouter);
apiRouter.use('/logbook', logbookRouter);
apiRouter.use('/sectors', sectorsRouter);
