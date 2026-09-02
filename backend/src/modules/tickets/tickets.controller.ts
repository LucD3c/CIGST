import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './tickets.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  // La consulta ya vino validada por el esquema de paginacion, con el tope
  // duro de 200 por pagina aplicado del lado del servidor.
  const pagina = await service.listarPagina(req.user!, req.query as never);
  res.json({
    tickets: pagina.items,
    total: pagina.total,
    page: pagina.page,
    pageSize: pagina.pageSize,
    totalPaginas: pagina.totalPaginas,
  });
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

// Numeros del tablero. Antes el navegador se traia todos los tickets solo para
// contarlos; ahora los cuenta la base y viajan seis numeros.
export const stats = asyncHandler(async (req: Request, res: Response) => {
  const estadisticas = await service.estadisticas(req.user!);
  res.json({ estadisticas });
});
