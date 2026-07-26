import { prisma } from '../../db/prisma';
import { ROLES } from '../../middleware/rbac.middleware';

const activeFilter = { deletedAt: null } as const;

// Nunca se selecciona passwordHash: ni siquiera para uso interno de este
// repositorio, para que sea imposible filtrarlo por error hacia una respuesta.
const publicSelect = {
  id: true,
  name: true,
  username: true,
  status: true,
  lastAccessAt: true,
  loginCount: true,
  createdAt: true,
  employeeId: true,
  role: { select: { name: true } },
  employee: { select: { id: true, name: true } },
} as const;

export function findTechnicians() {
  return prisma.user.findMany({
    where: { ...activeFilter, status: 'Activo', role: { name: { in: [ROLES.ADMIN, ROLES.SUPERVISOR] } } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export function findMany() {
  return prisma.user.findMany({
    where: activeFilter,
    select: publicSelect,
    orderBy: { createdAt: 'asc' },
  });
}

export function findById(id: string) {
  return prisma.user.findFirst({ where: { id, ...activeFilter }, select: publicSelect });
}

export function findByUsernameIncludingInactive(username: string) {
  return prisma.user.findFirst({ where: { username, ...activeFilter }, select: { id: true } });
}

export function findRoleByName(name: string) {
  return prisma.role.findUnique({ where: { name } });
}

export async function create(data: {
  name: string;
  username: string;
  passwordHash: string;
  roleId: string;
  employeeId: string | null;
}) {
  const created = await prisma.user.create({ data, select: publicSelect });
  return created;
}

export async function update(
  id: string,
  data: Partial<{
    name: string;
    roleId: string;
    employeeId: string | null;
    status: string;
    passwordHash: string;
  }>,
) {
  return prisma.user.update({ where: { id }, data, select: publicSelect });
}

// Borrado real (no logico): a pedido explicito del negocio, un usuario
// eliminado por un Administrador desaparece de verdad de la base. Las
// referencias opcionales (tickets, bitacora) quedan en null via SetNull en
// el schema; las sesiones de ese usuario se borran en cascada.
export function hardDelete(id: string) {
  return prisma.user.delete({ where: { id } });
}

export function countActiveAdmins(excludingId?: string) {
  return prisma.user.count({
    where: {
      ...activeFilter,
      status: 'Activo',
      role: { name: 'Administrador' },
      ...(excludingId ? { id: { not: excludingId } } : {}),
    },
  });
}
