import bcrypt from 'bcryptjs';
import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import { buildChangeLine, prependLog, nowStamp } from '../../utils/changeLog';
import { sortByName } from '../../utils/sortByName';
import * as repo from './users.repository';
import * as employeesRepo from '../employees/employees.repository';
import { logoutAllSessionsForUser } from '../auth/auth.service';
import type { CreateUserInput, UpdateUserInput } from './users.schema';
import { armarPagina, ordenar, saltear, type PaginationQuery } from '../../utils/pagination';

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

// Evita que la plataforma se quede sin ningun Administrador activo: solo
// importa cuando el usuario en cuestion ES hoy un admin activo (degradarlo,
// desactivarlo o borrarlo son los tres casos que podrian dejarla sin nadie
// que administre).
async function assertNotLastActiveAdmin(user: { id: string; status: string; role: { name: string } }) {
  if (user.role.name !== 'Administrador' || user.status !== 'Activo') return;
  const remaining = await repo.countActiveAdmins(user.id);
  if (remaining === 0) {
    throw HttpError.badRequest('No podés dejar la plataforma sin ningún Administrador activo.');
  }
}

export async function list() {
  return sortByName(await repo.findMany(), (u) => u.name);
}

const ORDEN: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>> = {
  name: (d) => ({ name: d }),
  username: (d) => ({ username: d }),
  status: (d) => ({ status: d }),
  lastAccessAt: (d) => ({ lastAccessAt: d }),
  createdAt: (d) => ({ createdAt: d }),
};

export async function listarPagina(query: PaginationQuery) {
  const where = repo.filtroBusqueda(query.q);
  const orderBy = ordenar(ORDEN, query.sort, query.dir, { name: 'asc' });
  const { items, total } = await repo.findPage(where, saltear(query.page, query.pageSize), query.pageSize, orderBy);
  return armarPagina(items, total, query.page, query.pageSize);
}

export async function listTechnicians() {
  return sortByName(await repo.findTechnicians(), (u) => u.name);
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
  const existing = await getById(id);
  if (data.employeeId !== undefined) await assertEmployeeAvailable(data.employeeId);
  const demoting = data.role !== undefined && data.role !== 'Administrador';
  const deactivating = data.status === 'Inactivo';
  if (demoting || deactivating) await assertNotLastActiveAdmin(existing);

  const patch: Partial<{ name: string; roleId: string; employeeId: string | null; status: string; passwordHash: string; changeLog: string }> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.employeeId !== undefined) patch.employeeId = data.employeeId;
  if (data.status !== undefined) patch.status = data.status;
  if (data.role !== undefined) patch.roleId = await resolveRoleId(data.role);
  if (data.password !== undefined) patch.passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Historial de cambios de la cuenta ("de X a Y", con fecha y hora): lo ve
  // el Administrador en el panel. La contraseña solo se registra como hecho,
  // nunca su valor.
  let newEmployeeName: string | null = existing.employee?.name ?? null;
  if (data.employeeId !== undefined) {
    newEmployeeName = data.employeeId ? (await employeesRepo.findById(data.employeeId))?.name ?? null : null;
  }
  const line = buildChangeLine([
    { label: 'Nombre', before: existing.name, after: data.name !== undefined ? data.name : existing.name },
    { label: 'Rol', before: existing.role.name, after: data.role !== undefined ? data.role : existing.role.name },
    { label: 'Estado', before: existing.status, after: data.status !== undefined ? data.status : existing.status },
    { label: 'Persona vinculada', before: existing.employee?.name ?? null, after: newEmployeeName },
  ]);
  const passwordLine = data.password !== undefined ? `${nowStamp()} — Contraseña actualizada` : null;
  const fullLine = [line, passwordLine].filter(Boolean).join('\n');
  if (fullLine) patch.changeLog = prependLog(existing.changeLog, fullLine);

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

export async function remove(id: string, actingUserId: string) {
  if (id === actingUserId) {
    throw HttpError.badRequest('No podés eliminar tu propio usuario.');
  }
  const existing = await getById(id);
  await assertNotLastActiveAdmin(existing);
  // Primero se cortan sus conexiones de tiempo real y despues se borra: si se
  // borrara antes, el socket quedaria abierto y autenticado contra un usuario
  // que ya no existe.
  await logoutAllSessionsForUser(id);
  return repo.hardDelete(id);
}
