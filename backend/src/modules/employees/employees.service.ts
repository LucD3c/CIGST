import { HttpError } from '../../utils/httpError';
import * as repo from './employees.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import * as equipmentRepo from '../equipment/equipment.repository';
import type { CreateEmployeeInput, UpdateEmployeeInput } from './employees.schema';

async function assertReplacementValid(replacementId: string | null | undefined, selfId?: string) {
  if (!replacementId) return;
  if (replacementId === selfId) throw HttpError.badRequest('Una persona no puede ser su propio reemplazo.');
  const found = await repo.existsActive(replacementId);
  if (!found) throw HttpError.badRequest('La persona de reemplazo indicada no existe.');
}

async function assertSectorValid(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const found = await sectorsRepo.existsActive(sectorId);
  if (!found) throw HttpError.badRequest('El sector indicado no existe.');
}

export async function list(q?: string) {
  return repo.findMany(q);
}

// La ficha de persona muestra el equipamiento de su mismo sector (ya no hay
// vinculo directo persona-equipo: el equipo se asigna a un sector, no a un
// individuo).
export async function getById(id: string) {
  const employee = await repo.findById(id);
  if (!employee) throw HttpError.notFound('Persona no encontrada.');
  const sectorEquipment = employee.sectorId ? await equipmentRepo.findBySector(employee.sectorId) : [];
  return { ...employee, sectorEquipment };
}

export async function create(data: CreateEmployeeInput) {
  await assertReplacementValid(data.replacementId ?? null);
  await assertSectorValid(data.sectorId ?? null);
  return repo.create(data);
}

export async function update(id: string, data: UpdateEmployeeInput) {
  await getById(id);
  if (data.replacementId !== undefined) await assertReplacementValid(data.replacementId, id);
  if (data.sectorId !== undefined) await assertSectorValid(data.sectorId);
  return repo.update(id, data);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
