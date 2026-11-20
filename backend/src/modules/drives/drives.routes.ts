import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import * as controller from './drives.controller';
import {
  createDriveSchema,
  updateDriveSchema,
  grantDriveAccessSchema,
  listItemsQuerySchema,
  fileQuerySchema,
  uploadQuerySchema,
  existsQuerySchema,
  deleteFileSchema,
} from './drives.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

const accesoParams = z.object({
  id: z.string().uuid('El identificador de la unidad debe ser un UUID valido.'),
  accessId: z.string().uuid('El identificador del acceso debe ser un UUID valido.'),
});

// Cada operacion abre una conexion al servidor de archivos de la empresa. Un
// limite propio evita que alguien use la plataforma para martillarlo.
const unidadesRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Demasiadas operaciones con unidades de red seguidas. Esperá unos segundos.' },
});

// Eliminar pide la contrasena de la unidad: ademas del freno por intentos
// fallidos que lleva el service, se acota cuantas eliminaciones por minuto.
const eliminarRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Demasiadas eliminaciones seguidas. Esperá un minuto.' },
});

export const drivesRouter = Router();

drivesRouter.use(requireAuth);

drivesRouter.get('/status', controller.status);

// Administracion: exclusiva del Administrador. Es la parte que decide a que
// servidor de archivos se conecta la plataforma y con que usuario.
drivesRouter.get('/admin', requireRole(ROLES.ADMIN), controller.adminList);
drivesRouter.post('/admin', requireRole(ROLES.ADMIN), unidadesRateLimiter, validate({ body: createDriveSchema }), controller.adminCreate);
drivesRouter.patch(
  '/admin/:id',
  requireRole(ROLES.ADMIN),
  unidadesRateLimiter,
  validate({ params: idParamSchema, body: updateDriveSchema }),
  controller.adminUpdate,
);
drivesRouter.delete('/admin/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.adminRemove);
drivesRouter.post('/admin/:id/test', requireRole(ROLES.ADMIN), unidadesRateLimiter, validate({ params: idParamSchema }), controller.adminTest);
drivesRouter.post(
  '/admin/:id/access',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: grantDriveAccessSchema }),
  controller.adminGrant,
);
drivesRouter.delete('/admin/:id/access/:accessId', requireRole(ROLES.ADMIN), validate({ params: accesoParams }), controller.adminRevoke);
drivesRouter.get('/admin/:id/events', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.adminEvents);

// Uso. El permiso lo resuelve el service: la unidad tiene que estar asignada
// a la persona o a su sector.
drivesRouter.get('/', controller.mine);
drivesRouter.get('/:id/items', unidadesRateLimiter, validate({ params: idParamSchema, query: listItemsQuerySchema }), controller.items);
drivesRouter.get('/:id/exists', unidadesRateLimiter, validate({ params: idParamSchema, query: existsQuerySchema }), controller.exists);
drivesRouter.get('/:id/download', unidadesRateLimiter, validate({ params: idParamSchema, query: fileQuerySchema }), controller.download);
// El archivo llega como cuerpo crudo (application/octet-stream) y se pasa al
// servidor de archivos a medida que llega: no se guarda en el disco de CIGST.
drivesRouter.put('/:id/upload', unidadesRateLimiter, validate({ params: idParamSchema, query: uploadQuerySchema }), controller.upload);
drivesRouter.post(
  '/:id/delete',
  eliminarRateLimiter,
  validate({ params: idParamSchema, body: deleteFileSchema }),
  controller.remove,
);
