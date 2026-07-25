import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './employees.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  const employees = await service.list(q);
  res.json({ employees });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const employee = await service.getById(req.params.id!);
  res.json({ employee });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const employee = await service.create(req.body);
  res.status(201).json({ employee });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const employee = await service.update(req.params.id!, req.body);
  res.json({ employee });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});
