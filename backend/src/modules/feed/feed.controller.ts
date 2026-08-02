import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './feed.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { before, limit, q } = req.query as { before?: string; limit?: number; q?: string };
  res.json(await service.list(req.user!, { before, limit, q }));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ post: await service.getById(req.user!, req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ post: await service.create(req.user!, req.body) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ post: await service.update(req.user!, req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.user!, req.params.id!);
  res.status(204).send();
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  res.json({ comments: await service.listComments(req.user!, req.params.id!) });
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body as { body: string };
  res.status(201).json({ comment: await service.addComment(req.user!, req.params.id!, body) });
});

export const removeComment = asyncHandler(async (req: Request, res: Response) => {
  await service.removeComment(req.user!, req.params.id!, req.params.commentId!);
  res.status(204).send();
});

export const toggleReaction = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.toggleReaction(req.user!, req.params.id!));
});

export const markViewed = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.markViewed(req.user!, req.params.id!));
});

export const listViewers = asyncHandler(async (req: Request, res: Response) => {
  res.json({ viewers: await service.listViewers(req.user!, req.params.id!) });
});

export const unseenCount = asyncHandler(async (req: Request, res: Response) => {
  res.json({ count: await service.unseenCount(req.user!) });
});
