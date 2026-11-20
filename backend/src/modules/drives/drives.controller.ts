import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../utils/logger';
import * as service from './drives.service';

type Q = Record<string, string>;

export const status = asyncHandler(async (_req: Request, res: Response) => {
  res.json(service.estado());
});

/* ---------- Uso ---------- */

export const mine = asyncHandler(async (req: Request, res: Response) => {
  res.json({ drives: await service.listarMias(req.user!) });
});

export const items = asyncHandler(async (req: Request, res: Response) => {
  const { path } = req.query as Q;
  res.json(await service.listarCarpeta(req.user!, req.params.id!, path ?? ''));
});

export const exists = asyncHandler(async (req: Request, res: Response) => {
  const { path, name } = req.query as Q;
  res.json(await service.existe(req.user!, req.params.id!, path ?? '', name!));
});

// Nombre del archivo en la descarga: con tildes y ñ (filename*) y una version
// solo ASCII para navegadores viejos. Nunca se arma con el nombre crudo entre
// comillas: un nombre con comillas romperia el encabezado.
function contentDisposition(nombre: string): string {
  const ascii = nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\%;]/g, '_') || 'archivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

export const download = asyncHandler(async (req: Request, res: Response) => {
  const { path } = req.query as Q;
  const d = await service.abrirDescarga(req.user!, req.params.id!, path!);

  // Si la persona cancela la descarga, se corta tambien la conexion con el
  // servidor de archivos: no se sigue leyendo para nadie.
  res.on('close', () => {
    if (!res.writableFinished) d.cancelar();
  });

  // Siempre como descarga y nunca interpretado por el navegador: el contenido
  // de una unidad de red lo pudo haber puesto cualquiera.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(d.nombre));
  res.setHeader('Content-Length', String(d.tamano));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  d.datos.pipe(res);
  d.fin.catch((err) => {
    // Fallo a mitad de camino (se corto la red, se borro el archivo...). Ya se
    // mandaron encabezados y parte del archivo: lo correcto es cortar, y el
    // navegador marca la descarga como fallida en vez de guardar un archivo roto.
    if (!res.writableFinished) {
      logger.warn({ codigo: (err as { codigo?: string }).codigo }, 'Descarga de unidad de red interrumpida');
      res.destroy();
    }
  });
});

export const upload = async (req: Request, res: Response, next: (err?: unknown) => void) => {
  const { path, name } = req.query as Q;
  let cancelar: (() => void) | null = null;
  res.on('close', () => {
    if (!res.writableFinished && cancelar) cancelar();
  });
  try {
    const r = await service.subir(req.user!, req.params.id!, path ?? '', name!, req, (c) => {
      cancelar = c;
    });
    res.status(201).json(r);
  } catch (err) {
    // Si la subida se rechaza (nombre repetido, sin permiso...) el navegador
    // puede seguir mandando el archivo. Se cierra la conexion despues de
    // responder para no tener que recibir gigas que se van a descartar.
    if (!res.headersSent) res.setHeader('Connection', 'close');
    next(err);
  }
};

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { path, password } = req.body as { path: string; password: string };
  await service.eliminarArchivo(req.user!, req.params.id!, path, password);
  res.status(204).send();
});

/* ---------- Administracion ---------- */

export const adminList = asyncHandler(async (req: Request, res: Response) => {
  res.json({ drives: await service.listarTodas(req.user!) });
});

export const adminCreate = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ drive: await service.crear(req.user!, req.body) });
});

export const adminUpdate = asyncHandler(async (req: Request, res: Response) => {
  res.json({ drive: await service.actualizar(req.user!, req.params.id!, req.body) });
});

export const adminRemove = asyncHandler(async (req: Request, res: Response) => {
  await service.desvincular(req.user!, req.params.id!);
  res.status(204).send();
});

export const adminTest = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.probarAdmin(req.user!, req.params.id!));
});

export const adminGrant = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ drive: await service.darAcceso(req.user!, req.params.id!, req.body) });
});

export const adminRevoke = asyncHandler(async (req: Request, res: Response) => {
  res.json({ drive: await service.quitarAcceso(req.user!, req.params.id!, req.params.accessId!) });
});

export const adminEvents = asyncHandler(async (req: Request, res: Response) => {
  res.json({ events: await service.actividad(req.user!, req.params.id!) });
});
