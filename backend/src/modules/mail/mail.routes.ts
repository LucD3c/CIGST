import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import * as controller from './mail.controller';
import {
  createProviderSchema,
  updateProviderSchema,
  createAccountSchema,
  updateAccountSchema,
  grantAccessSchema,
  listMessagesSchema,
  sendMessageSchema,
} from './mail.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole, ROLES } from '../../middleware/rbac.middleware';

const uuid = (que: string) => z.string().uuid(`El identificador ${que} debe ser un UUID valido.`);
const uidParams = z.object({ id: uuid('de la casilla'), uid: z.coerce.number().int().positive() });
const adjuntoParams = uidParams.extend({ indice: z.coerce.number().int().min(0).max(50) });
const accesoParams = z.object({ id: uuid('de la casilla'), accessId: uuid('del acceso') });

// Cada operacion de correo abre una conexion a un servidor de afuera. Sin un
// limite propio, alguien podria usar la plataforma para golpear al proveedor
// (y hacer que le bloqueen la casilla a la empresa por abuso). Es mas acotado
// que el limite general de la API justamente porque el costo no es solo local.
const correoRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Demasiadas operaciones de correo seguidas. Esperá unos segundos.' },
});

// Enviar es todavia mas sensible: un envio masivo desde la casilla de la
// empresa la deja marcada como spam en todos lados.
const envioRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonimo',
  message: { error: 'Alcanzaste el límite de envíos por ahora. Esperá unos minutos.' },
});

export const mailRouter = Router();

mailRouter.use(requireAuth);

mailRouter.get('/status', controller.status);
mailRouter.get('/providers/available', controller.listProvidersForUsers);

// Configuracion de servidores: exclusiva del Administrador. Es la parte que
// decide a donde se conecta el backend.
mailRouter.get('/providers', requireRole(ROLES.ADMIN), controller.listProviders);
mailRouter.post('/providers', requireRole(ROLES.ADMIN), validate({ body: createProviderSchema }), controller.createProvider);
mailRouter.patch(
  '/providers/:id',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: updateProviderSchema }),
  controller.updateProvider,
);
mailRouter.delete('/providers/:id', requireRole(ROLES.ADMIN), validate({ params: idParamSchema }), controller.removeProvider);
mailRouter.get('/admin/accounts', requireRole(ROLES.ADMIN), controller.listAllAccounts);
mailRouter.get('/admin/diagnostico', requireRole(ROLES.ADMIN), controller.diagnostico);

// Casillas: cada uno administra las suyas. El service comprueba ademas que
// una casilla compartida solo la toque un Administrador.
mailRouter.get('/accounts', controller.listAccounts);
mailRouter.post('/accounts', correoRateLimiter, validate({ body: createAccountSchema }), controller.createAccount);
mailRouter.patch(
  '/accounts/:id',
  correoRateLimiter,
  validate({ params: idParamSchema, body: updateAccountSchema }),
  controller.updateAccount,
);
mailRouter.delete('/accounts/:id', validate({ params: idParamSchema }), controller.removeAccount);
mailRouter.post('/accounts/:id/test', correoRateLimiter, validate({ params: idParamSchema }), controller.testAccount);

mailRouter.post(
  '/accounts/:id/access',
  requireRole(ROLES.ADMIN),
  validate({ params: idParamSchema, body: grantAccessSchema }),
  controller.grantAccess,
);
mailRouter.delete('/accounts/:id/access/:accessId', requireRole(ROLES.ADMIN), validate({ params: accesoParams }), controller.revokeAccess);

// Uso de la casilla. El permiso lo resuelve el service: hay que ser el dueno
// o tener acceso concedido a la casilla compartida.
mailRouter.get('/accounts/:id/folders', correoRateLimiter, validate({ params: idParamSchema }), controller.folders);
mailRouter.get(
  '/accounts/:id/messages',
  correoRateLimiter,
  validate({ params: idParamSchema, query: listMessagesSchema }),
  controller.messages,
);
mailRouter.get('/accounts/:id/messages/:uid', correoRateLimiter, validate({ params: uidParams }), controller.message);
mailRouter.get(
  '/accounts/:id/messages/:uid/attachments/:indice',
  correoRateLimiter,
  validate({ params: adjuntoParams }),
  controller.attachment,
);
mailRouter.post('/accounts/:id/messages/:uid/read', correoRateLimiter, validate({ params: uidParams }), controller.setRead);
mailRouter.delete('/accounts/:id/messages/:uid', correoRateLimiter, validate({ params: uidParams }), controller.removeMessage);
mailRouter.post(
  '/accounts/:id/send',
  envioRateLimiter,
  validate({ params: idParamSchema, body: sendMessageSchema }),
  controller.send,
);
