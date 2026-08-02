// PERMISOS DE LAS BASES DE CONOCIMIENTO
//
// Quien crea una base -o un Administrador- decide quien la lee y quien la
// edita. Un permiso apunta a UNA sola cosa: un sector, un rango o una persona
// puntual. Se acumulan: alcanza con que uno de ellos habilite.
//
// Regla de oro: esto se resuelve SIEMPRE contra la base y del lado del
// servidor. Ocultar un boton en la interfaz no es un permiso; cada endpoint
// vuelve a preguntar aca antes de responder.

import { prisma } from '../../db/prisma';
import { HttpError } from '../../utils/httpError';
import { ROLES } from '../../middleware/rbac.middleware';
import type { SessionUser } from '../auth/auth.service';

export type Nivel = 'lectura' | 'edicion';

async function sectorDe(user: SessionUser): Promise<string | null> {
  if (!user.employeeId) return null;
  const empleado = await prisma.employee.findFirst({
    where: { id: user.employeeId, deletedAt: null },
    select: { sectorId: true },
  });
  return empleado?.sectorId ?? null;
}

/**
 * Nivel de acceso de esta persona sobre esta base: 'edicion', 'lectura' o
 * null (sin acceso).
 *
 * El Administrador siempre tiene edicion: es quien administra la plataforma y
 * tiene que poder arreglar o dar de baja una base aunque no la haya creado.
 * Quien creo la base tambien conserva edicion, para no quedar afuera de lo
 * propio por un error al configurar los permisos.
 */
export async function nivelDe(user: SessionUser, spaceId: string): Promise<Nivel | null> {
  const space = await prisma.kbSpace.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: { id: true, createdById: true, status: true },
  });
  if (!space) return null;

  if (user.role === ROLES.ADMIN) return 'edicion';
  if (space.createdById === user.id) return 'edicion';

  const sectorId = await sectorDe(user);
  const permisos = await prisma.kbPermission.findMany({
    where: {
      spaceId,
      OR: [
        { userId: user.id },
        { role: user.role },
        ...(sectorId ? [{ sectorId }] : []),
      ],
    },
    select: { level: true },
  });
  if (!permisos.length) return null;
  return permisos.some((p) => p.level === 'edicion') ? 'edicion' : 'lectura';
}

export async function assertPuedeLeer(user: SessionUser, spaceId: string): Promise<Nivel> {
  const nivel = await nivelDe(user, spaceId);
  // Mismo mensaje exista o no la base: quien no tiene acceso no deberia poder
  // deducir que bases existen probando identificadores.
  if (!nivel) throw HttpError.notFound('Base de conocimiento no encontrada.');
  return nivel;
}

export async function assertPuedeEditar(user: SessionUser, spaceId: string) {
  const nivel = await nivelDe(user, spaceId);
  if (!nivel) throw HttpError.notFound('Base de conocimiento no encontrada.');
  if (nivel !== 'edicion') throw HttpError.forbidden('No tenés permiso para editar esta base de conocimiento.');
}

/** Crear bases y administrar sus permisos es exclusivo del Administrador. */
export function assertPuedeAdministrar(user: SessionUser) {
  if (user.role !== ROLES.ADMIN) {
    throw HttpError.forbidden('Solo un Administrador puede crear o configurar bases de conocimiento.');
  }
}

/**
 * Ids de las bases que esta persona puede ver, con su nivel. Se resuelve en
 * pocas consultas para no preguntar una vez por base.
 */
export async function basesVisibles(user: SessionUser): Promise<Map<string, Nivel>> {
  const espacios = await prisma.kbSpace.findMany({
    where: { deletedAt: null },
    select: { id: true, createdById: true },
  });
  const resultado = new Map<string, Nivel>();

  if (user.role === ROLES.ADMIN) {
    for (const e of espacios) resultado.set(e.id, 'edicion');
    return resultado;
  }

  const sectorId = await sectorDe(user);
  const permisos = await prisma.kbPermission.findMany({
    where: {
      OR: [{ userId: user.id }, { role: user.role }, ...(sectorId ? [{ sectorId }] : [])],
    },
    select: { spaceId: true, level: true },
  });

  for (const e of espacios) {
    if (e.createdById === user.id) resultado.set(e.id, 'edicion');
  }
  for (const p of permisos) {
    const actual = resultado.get(p.spaceId);
    if (actual === 'edicion') continue;
    resultado.set(p.spaceId, p.level === 'edicion' ? 'edicion' : 'lectura');
  }
  return resultado;
}

/** Usuarios activos que pueden leer una base (para avisos y tiempo real). */
export async function usuariosConAcceso(spaceId: string): Promise<string[]> {
  const space = await prisma.kbSpace.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: { createdById: true },
  });
  if (!space) return [];

  const permisos = await prisma.kbPermission.findMany({
    where: { spaceId },
    select: { sectorId: true, role: true, userId: true },
  });

  const sectorIds = permisos.map((p) => p.sectorId).filter((x): x is string => Boolean(x));
  const roles = permisos.map((p) => p.role).filter((x): x is string => Boolean(x));
  const userIds = permisos.map((p) => p.userId).filter((x): x is string => Boolean(x));

  const condiciones: Record<string, unknown>[] = [{ role: { name: ROLES.ADMIN } }];
  if (space.createdById) condiciones.push({ id: space.createdById });
  if (userIds.length) condiciones.push({ id: { in: userIds } });
  if (roles.length) condiciones.push({ role: { name: { in: roles } } });
  if (sectorIds.length) condiciones.push({ employee: { sectorId: { in: sectorIds }, deletedAt: null } });

  const usuarios = await prisma.user.findMany({
    where: { deletedAt: null, status: 'Activo', OR: condiciones },
    select: { id: true },
  });
  return usuarios.map((u) => u.id);
}
