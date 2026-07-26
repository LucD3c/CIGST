import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './chat.service';

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const conversations = await service.listConversations(req.user!.id);
  res.json({ conversations });
});

export const startConversation = asyncHandler(async (req: Request, res: Response) => {
  const { recipientId, body } = req.body as { recipientId: string; body: string };
  const result = await service.startConversation(req.user!.id, recipientId, body);
  res.status(201).json(result);
});

export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const { before, after, limit } = req.query as { before?: string; after?: string; limit?: number };
  if (after) {
    const messages = await service.pollNewMessages(req.user!.id, req.params.id!, after);
    return res.json({ messages, hasMore: false });
  }
  const result = await service.getMessages(req.user!.id, req.params.id!, before, limit);
  res.json(result);
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body as { body: string };
  const message = await service.sendMessage(req.user!.id, req.params.id!, body);
  res.status(201).json({ message });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await service.markRead(req.user!.id, req.params.id!);
  res.status(204).send();
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await service.unreadTotal(req.user!.id);
  res.json({ count });
});

export const directory = asyncHandler(async (req: Request, res: Response) => {
  const users = await service.directory(req.user!.id);
  res.json({ users });
});
