import bcrypt from 'bcryptjs';
import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import * as repo from './users.repository';
import * as employeesRepo from '../employees/employees.repository';
import { logoutAllSessionsForUser } from '../auth/auth.service';
import type { CreateUserInput, UpdateUserInput } from './users.schema';

const SALT_ROUNDS = 12;

async function resolveRoleId(roleName: string) {
  const role = await repo.findRoleByName(roleName);
  if (!role) throw HttpError.badRequest(`El rol "${roleName}" no existe.`);
  return role.id;
}

async function assertEmployeeAvailable(employeeId: string | null | undefined) {
  if (!employeeId) return;
  const found = await employeesRepo.existsActive(employeeId);
  if (!found) throw HttpError.badRequest('La persona vinculada indicada no existe.');
}

export async function list() {
  return repo.findMany();
}

export async function getById(id: string) {
  const user = await repo.findById(id);
  if (!user) throw HttpError.notFound('Usuario no encontrado.');
  return user;
}

export async function create(data: CreateUserInput) {
  await assertEmployeeAvailable(data.employeeId);
  const roleId = await resolveRoleId(data.role);
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  try {
    return await repo.create({
      name: data.name,
      username: data.username,
      passwordHash,
      roleId,
      employeeId: data.employeeId ?? null,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw HttpError.conflict('Ya existe un usuario con ese nombre de usuario o esa persona ya tiene un usuario vinculado.');
    }
    throw err;
  }
}

export async function update(id: string, data: UpdateUserInput) {
  await getById(id);
  if (data.employeeId !== undefined) await assertEmployeeAvailable(data.employeeId);

  const patch: Partial<{ name: string; roleId: string; employeeId: string | null; status: string; passwordHash: string }> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.employeeId !== undefined) patch.employeeId = data.employeeId;
  if (data.status !== undefined) patch.status = data.status;
  if (data.role !== undefined) patch.roleId = await resolveRoleId(data.role);
  if (data.password !== undefined) patch.passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  try {
    const updated = await repo.update(id, patch);
    if (data.status === 'Inactivo' || data.password !== undefined) {
      await logoutAllSessionsForUser(id);
    }
    return updated;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw HttpError.conflict('Esa persona ya tiene un usuario vinculado.');
    }
    throw err;
  }
}

export async function remove(id: string) {
  await getById(id);
  const removed = await repo.softDelete(id);
  await logoutAllSessionsForUser(id);
  return removed;
}
