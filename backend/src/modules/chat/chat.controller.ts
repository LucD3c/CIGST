import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './chat.service';

// Devuelve grupos y conversaciones 1 a 1 juntos: los grupos van aparte para
// que la interfaz los fije siempre primeros en la lista de Mensajes.
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const [conversations, groups] = await Promise.all([
    service.listConversations(req.user!.id),
    service.listGroups(req.user!.id),
  ]);
  res.json({ conversations, groups });
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

/* ---------- Grupos ---------- */

export const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const { name, memberIds } = req.body as { name: string; memberIds: string[] };
  const group = await service.createGroup(req.user!.id, name, memberIds);
  res.status(201).json({ group });
});

export const updateGroup = asyncHandler(async (req: Request, res: Response) => {
  const group = await service.updateGroup(req.user!.id, req.params.id!, req.body);
  res.json({ group });
});

export const removeGroup = asyncHandler(async (req: Request, res: Response) => {
  await service.removeGroup(req.params.id!);
  res.status(204).send();
});

export const getGroupMessages = asyncHandler(async (req: Request, res: Response) => {
  const { before, after, limit } = req.query as { before?: string; after?: string; limit?: number };
  if (after) {
    const messages = await service.pollGroupMessages(req.user!.id, req.params.id!, after);
    return res.json({ messages, hasMore: false });
  }
  const result = await service.getGroupMessages(req.user!.id, req.params.id!, before, limit);
  res.json(result);
});

export const sendGroupMessage = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body as { body: string };
  const message = await service.sendGroupMessage(req.user!.id, req.params.id!, body);
  res.status(201).json({ message });
});

export const markGroupRead = asyncHandler(async (req: Request, res: Response) => {
  await service.markGroupRead(req.user!.id, req.params.id!);
  res.status(204).send();
});
