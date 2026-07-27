import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './sectors.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  const sectors = await service.list(q);
  res.json({ sectors });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const sector = await service.getById(req.params.id!);
  res.json({ sector });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const sector = await service.create(req.body);
  res.status(201).json({ sector });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const sector = await service.update(req.params.id!, req.body);
  res.json({ sector });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});

export const addCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await service.addCategory(req.params.id!, req.body);
  res.status(201).json({ category });
});

export const removeCategory = asyncHandler(async (req: Request, res: Response) => {
  await service.removeCategory(req.params.id!, req.params.categoryId!);
  res.status(204).send();
});
