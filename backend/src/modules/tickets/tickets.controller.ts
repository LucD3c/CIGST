import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError } from '../../utils/httpError';
import { ROLES } from '../../middleware/rbac.middleware';
import { createTicketByStaffSchema, createTicketSelfServiceSchema } from './tickets.schema';
import * as service from './tickets.service';

function isStaff(role: string) {
  return role === ROLES.ADMIN || role === ROLES.SUPERVISOR;
}

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
  const user = req.user!;
  if (isStaff(user.role)) {
    const parsed = createTicketByStaffSchema.safeParse(req.body);
    if (!parsed.success) throw HttpError.badRequest('Datos de ticket inválidos.', parsed.error.flatten());
    const ticket = await service.createByStaff(user, parsed.data);
    return res.status(201).json({ ticket });
  }

  const parsed = createTicketSelfServiceSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest('Datos de solicitud inválidos.', parsed.error.flatten());
  const ticket = await service.createSelfService(user, parsed.data);
  res.status(201).json({ ticket });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await service.update(req.params.id!, req.body);
  res.json({ ticket });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.params.id!);
  res.status(204).send();
});
