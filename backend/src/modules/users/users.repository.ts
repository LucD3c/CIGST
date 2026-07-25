import { prisma } from '../../db/prisma';

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
    where: { ...activeFilter, status: 'Activo', role: { name: { in: ['Administrador', 'Técnico'] } } },
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

export function softDelete(id: string) {
  return prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'Inactivo' },
    select: publicSelect,
  });
}
