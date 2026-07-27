import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './tickets.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  const tickets = await service.list(req.user!, q);
  res.json({ tickets });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.getById(req.user!, req.params.id!);
  res.json({ ticket });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.create(req.user!, req.body);
  res.status(201).json({ ticket });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.update(req.user!, req.params.id!, req.body);
  res.json({ ticket });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});

export const formOptions = asyncHandler(async (_req: Request, res: Response) => {
  const options = await service.formOptions();
  res.json(options);
});
