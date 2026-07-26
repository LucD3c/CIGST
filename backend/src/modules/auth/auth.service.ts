import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';
import { generateSessionToken, hashSessionToken } from '../../utils/sessionToken';

export type SessionUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  status: string;
  employeeId: string | null;
};

type LoginMeta = {
  ipAddress?: string;
  userAgent?: string;
};

function ttlMs() {
  return env.SESSION_TTL_HOURS * 60 * 60 * 1000;
}

function toSessionUser(user: {
  id: string;
  name: string;
  username: string;
  status: string;
  employeeId: string | null;
  role: { name: string };
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role.name,
    status: user.status,
    employeeId: user.employeeId,
  };
}

export async function login(username: string, password: string, meta: LoginMeta) {
  const user = await prisma.user.findFirst({
    where: { username, deletedAt: null },
    include: { role: true },
  });

  // Mismo mensaje generico exista o no el usuario: no dar pistas a quien intenta
  // adivinar cuentas validas.
  const genericError = () => HttpError.unauthorized('Usuario o contraseña incorrectos.');

  if (!user || user.status !== 'Activo') throw genericError();

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) throw genericError();

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs());

  await prisma.$transaction([
    prisma.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ipAddress?.slice(0, 64),
        expiresAt,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastAccessAt: new Date(), loginCount: { increment: 1 } },
    }),
  ]);

  return { token, expiresAt, user: toSessionUser(user) };
}

export async function logout(token: string) {
  const tokenHash = hashSessionToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function resolveSession(token: string): Promise<SessionUser | null> {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true } } },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now() || session.user.deletedAt || session.user.status !== 'Activo') {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const remainingMs = session.expiresAt.getTime() - Date.now();
  if (remainingMs < ttlMs() / 2) {
    await prisma.session
      .update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + ttlMs()) } })
      .catch(() => undefined);
  }

  return toSessionUser(session.user);
}

export async function logoutAllSessionsForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

export type OwnEmployeeContext = {
  id: string;
  name: string;
  sectorId: string | null;
  sectorName: string | null;
  schedule: string | null;
  workShift: string | null;
  extension: string | null;
  equipment: { id: string; type: string; model: string | null }[];
};

// El portal de autogestion del Empleado necesita su propio sector/horario/equipo
// para prellenar el formulario de un ticket nuevo, pero ese rol no tiene acceso
// a GET /api/employees (es solo para soporte). En vez de abrir ese endpoint,
// se expone unicamente lo propio a traves de /api/auth/me: su sector y el
// equipamiento de ese sector (el equipo ya no se vincula a una persona, sino
// a un sector completo).
export async function getOwnEmployeeContext(employeeId: string): Promise<OwnEmployeeContext | null> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: {
      id: true,
      name: true,
      sectorId: true,
      sector: { select: { name: true } },
      schedule: true,
      workShift: true,
      extension: true,
    },
  });
  if (!employee) return null;

  const equipment = employee.sectorId
    ? await prisma.equipment.findMany({
        where: { sectorId: employee.sectorId, deletedAt: null, status: 'Activo' },
        select: { id: true, type: true, model: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  return {
    id: employee.id,
    name: employee.name,
    sectorId: employee.sectorId,
    sectorName: employee.sector?.name ?? null,
    schedule: employee.schedule,
    workShift: employee.workShift,
    extension: employee.extension,
    equipment,
  };
}
