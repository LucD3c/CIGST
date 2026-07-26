import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './schedules.service';

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const schedules = await service.list();
  res.json({ schedules });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await service.getById(req.params.id!);
  res.json({ schedule });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await service.create(req.body);
  res.status(201).json({ schedule });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await service.update(req.params.id!, req.body);
  res.json({ schedule });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});
