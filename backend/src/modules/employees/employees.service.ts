import { HttpError } from '../../utils/httpError';
import * as repo from './employees.repository';
import type { CreateEmployeeInput, UpdateEmployeeInput } from './employees.schema';

async function assertReplacementValid(replacementId: string | null | undefined, selfId?: string) {
  if (!replacementId) return;
  if (replacementId === selfId) throw HttpError.badRequest('Una persona no puede ser su propio reemplazo.');
  const found = await repo.existsActive(replacementId);
  if (!found) throw HttpError.badRequest('La persona de reemplazo indicada no existe.');
}

export async function list(q?: string) {
  return repo.findMany(q);
}

export async function getById(id: string) {
  const employee = await repo.findById(id);
  if (!employee) throw HttpError.notFound('Persona no encontrada.');
  return employee;
}

export async function create(data: CreateEmployeeInput) {
  await assertReplacementValid(data.replacementId ?? null);
  return repo.create(data);
}

export async function update(id: string, data: UpdateEmployeeInput) {
  await getById(id);
  if (data.replacementId !== undefined) await assertReplacementValid(data.replacementId, id);
  return repo.update(id, data);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
