import { Router } from 'express';
import * as controller from './chat.controller';
import { startConversationSchema, sendMessageSchema, listMessagesQuerySchema } from './chat.schema';
import { idParamSchema } from '../../utils/commonSchemas';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { chatMessageRateLimiter } from '../../middleware/rateLimit.middleware';

export const chatRouter = Router();

// El chat es entre personas, no por jerarquia: los 3 roles lo usan igual,
// sin restriccion de rol en ningun endpoint (salvo estar autenticado y ser
// participante de la conversacion, verificado en el service).
chatRouter.use(requireAuth);

chatRouter.get('/directory', controller.directory);
chatRouter.get('/unread-count', controller.unreadCount);

chatRouter.get('/conversations', controller.listConversations);
chatRouter.post(
  '/conversations',
  chatMessageRateLimiter,
  validate({ body: startConversationSchema }),
  controller.startConversation,
);

chatRouter.get(
  '/conversations/:id/messages',
  validate({ params: idParamSchema, query: listMessagesQuerySchema }),
  controller.getMessages,
);
chatRouter.post(
  '/conversations/:id/messages',
  chatMessageRateLimiter,
  validate({ params: idParamSchema, body: sendMessageSchema }),
  controller.sendMessage,
);

chatRouter.post('/conversations/:id/read', validate({ params: idParamSchema }), controller.markRead);
