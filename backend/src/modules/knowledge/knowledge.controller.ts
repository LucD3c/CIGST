import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './knowledge.service';

export const listSpaces = asyncHandler(async (req: Request, res: Response) => {
  res.json({ spaces: await service.listSpaces(req.user!) });
});

export const getSpace = asyncHandler(async (req: Request, res: Response) => {
  res.json({ space: await service.getSpace(req.user!, req.params.id!) });
});

export const createSpace = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ space: await service.createSpace(req.user!, req.body) });
});

export const updateSpace = asyncHandler(async (req: Request, res: Response) => {
  res.json({ space: await service.updateSpace(req.user!, req.params.id!, req.body) });
});

export const removeSpace = asyncHandler(async (req: Request, res: Response) => {
  await service.removeSpace(req.user!, req.params.id!);
  res.status(204).send();
});

export const createSection = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body as { name: string };
  res.status(201).json({ section: await service.createSection(req.user!, req.params.id!, name) });
});

export const updateSection = asyncHandler(async (req: Request, res: Response) => {
  res.json({ section: await service.updateSection(req.user!, req.params.sectionId!, req.body) });
});

export const removeSection = asyncHandler(async (req: Request, res: Response) => {
  await service.removeSection(req.user!, req.params.sectionId!);
  res.status(204).send();
});

export const getArticle = asyncHandler(async (req: Request, res: Response) => {
  res.json({ article: await service.getArticle(req.user!, req.params.articleId!) });
});

export const createArticle = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ article: await service.createArticle(req.user!, req.body) });
});

export const updateArticle = asyncHandler(async (req: Request, res: Response) => {
  res.json({ article: await service.updateArticle(req.user!, req.params.articleId!, req.body) });
});

export const removeArticle = asyncHandler(async (req: Request, res: Response) => {
  await service.removeArticle(req.user!, req.params.articleId!);
  res.status(204).send();
});

export const listPermissions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ permissions: await service.listPermissions(req.user!, req.params.id!) });
});

export const addPermission = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ permission: await service.addPermission(req.user!, req.params.id!, req.body) });
});

export const removePermission = asyncHandler(async (req: Request, res: Response) => {
  await service.removePermission(req.user!, req.params.id!, req.params.permissionId!);
  res.status(204).send();
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q: string };
  res.json({ results: await service.search(req.user!, q) });
});
