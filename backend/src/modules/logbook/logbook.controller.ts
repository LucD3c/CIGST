import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './logbook.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagina = await service.listarPagina(req.query as never);
  res.json({
    entries: pagina.items,
    total: pagina.total,
    page: pagina.page,
    pageSize: pagina.pageSize,
    totalPaginas: pagina.totalPaginas,
  });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const entry = await service.getById(req.params.id!);
  res.json({ entry });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const entry = await service.create(req.user!.id, req.body);
  res.status(201).json({ entry });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const entry = await service.update(req.params.id!, req.body);
  res.json({ entry });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});
