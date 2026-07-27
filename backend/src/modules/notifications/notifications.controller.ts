import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './notifications.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listForUser(req.user!.id);
  res.json(result);
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await service.unreadCount(req.user!.id);
  res.json({ count });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await service.markRead(req.params.id!, req.user!.id);
  res.status(204).send();
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await service.markAllRead(req.user!.id);
  res.status(204).send();
});
