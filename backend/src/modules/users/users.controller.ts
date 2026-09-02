import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './users.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagina = await service.listarPagina(req.query as never);
  res.json({
    users: pagina.items,
    total: pagina.total,
    page: pagina.page,
    pageSize: pagina.pageSize,
    totalPaginas: pagina.totalPaginas,
  });
});

export const listTechnicians = asyncHandler(async (_req: Request, res: Response) => {
  const technicians = await service.listTechnicians();
  res.json({ technicians });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.getById(req.params.id!);
  res.json({ user });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.create(req.body);
  res.status(201).json({ user });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.update(req.params.id!, req.body);
  res.json({ user });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!, req.user!.id);
  res.status(204).send();
});
