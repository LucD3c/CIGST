import { HttpError } from '../../utils/httpError';
import * as repo from './equipment.repository';
import * as employeesRepo from '../employees/employees.repository';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schema';

async function assertEmployeeValid(employeeId: string | null | undefined) {
  if (!employeeId) return;
  const found = await employeesRepo.existsActive(employeeId);
  if (!found) throw HttpError.badRequest('La persona responsable indicada no existe.');
}

export async function list(q?: string) {
  return repo.findMany(q);
}

export async function getById(id: string) {
  const equipment = await repo.findById(id);
  if (!equipment) throw HttpError.notFound('Equipo no encontrado.');
  return equipment;
}

export async function create(data: CreateEquipmentInput) {
  await assertEmployeeValid(data.employeeId ?? null);
  return repo.create(data);
}

export async function update(id: string, data: UpdateEquipmentInput) {
  await getById(id);
  if (data.employeeId !== undefined) await assertEmployeeValid(data.employeeId);
  return repo.update(id, data);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
