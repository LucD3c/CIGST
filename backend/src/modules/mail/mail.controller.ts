import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as service from './mail.service';

export const status = asyncHandler(async (req: Request, res: Response) => {
  const base = service.estado();
  // Se informa de una sola vez cuantas casillas quedaron con la contrasena
  // ilegible (tipicamente tras restaurar una copia con otra clave de cifrado),
  // para poder avisarlo por adelantado en vez de fallar de a una.
  const ilegibles = base.disponible ? await service.casillasIlegibles(req.user!) : 0;
  res.json({ ...base, casillasIlegibles: ilegibles });
});

/* ---------- Proveedores ---------- */

export const listProviders = asyncHandler(async (req: Request, res: Response) => {
  res.json({ providers: await service.listProviders(req.user!) });
});

export const listProvidersForUsers = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ providers: await service.listProvidersForUsers() });
});

export const createProvider = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ provider: await service.createProvider(req.user!, req.body) });
});

export const updateProvider = asyncHandler(async (req: Request, res: Response) => {
  res.json({ provider: await service.updateProvider(req.user!, req.params.id!, req.body) });
});

export const removeProvider = asyncHandler(async (req: Request, res: Response) => {
  await service.removeProvider(req.user!, req.params.id!);
  res.status(204).send();
});

/* ---------- Casillas ---------- */

export const listAccounts = asyncHandler(async (req: Request, res: Response) => {
  res.json({ accounts: await service.listAccounts(req.user!) });
});

export const listAllAccounts = asyncHandler(async (req: Request, res: Response) => {
  res.json({ accounts: await service.listAllAccounts(req.user!) });
});

export const createAccount = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ account: await service.createAccount(req.user!, req.body) });
});

export const updateAccount = asyncHandler(async (req: Request, res: Response) => {
  res.json({ account: await service.updateAccount(req.user!, req.params.id!, req.body) });
});

export const removeAccount = asyncHandler(async (req: Request, res: Response) => {
  await service.removeAccount(req.user!, req.params.id!);
  res.status(204).send();
});

export const testAccount = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.testAccount(req.user!, req.params.id!));
});

export const grantAccess = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ access: await service.grantAccess(req.user!, req.params.id!, req.body) });
});

export const revokeAccess = asyncHandler(async (req: Request, res: Response) => {
  await service.revokeAccess(req.user!, req.params.id!, req.params.accessId!);
  res.status(204).send();
});

/* ---------- Uso ---------- */

export const folders = asyncHandler(async (req: Request, res: Response) => {
  res.json({ folders: await service.folders(req.user!, req.params.id!) });
});

export const messages = asyncHandler(async (req: Request, res: Response) => {
  const { folder, page, q } = req.query as { folder?: string; page?: number; q?: string };
  res.json(await service.messages(req.user!, req.params.id!, { folder, page, q }));
});

export const message = asyncHandler(async (req: Request, res: Response) => {
  const { folder, imagenes } = req.query as { folder?: string; imagenes?: string };
  const uid = Number(req.params.uid);
  res.json({
    message: await service.message(req.user!, req.params.id!, folder || 'INBOX', uid, {
      mostrarImagenes: imagenes === '1',
    }),
  });
});

export const attachment = asyncHandler(async (req: Request, res: Response) => {
  const { folder } = req.query as { folder?: string };
  const uid = Number(req.params.uid);
  const indice = Number(req.params.indice);
  const a = await service.downloadAttachment(req.user!, req.params.id!, folder || 'INBOX', uid, indice);
  // Siempre como descarga: un adjunto de correo viene de afuera y no se
  // muestra dentro de la pagina bajo ningun concepto.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.nombre)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(a.contenido);
});

export const setRead = asyncHandler(async (req: Request, res: Response) => {
  const { folder, read } = req.body as { folder: string; read: boolean };
  await service.setRead(req.user!, req.params.id!, folder, Number(req.params.uid), read !== false);
  res.status(204).send();
});

export const removeMessage = asyncHandler(async (req: Request, res: Response) => {
  const { folder } = req.query as { folder?: string };
  res.json(await service.remove(req.user!, req.params.id!, folder || 'INBOX', Number(req.params.uid)));
});

export const send = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await service.send(req.user!, req.params.id!, req.body));
});

export const diagnostico = asyncHandler(async (req: Request, res: Response) => {
  res.json(service.diagnostico(req.user!));
});
