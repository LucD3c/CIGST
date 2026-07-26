import { HttpError } from '../../utils/httpError';
import * as repo from './equipment.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schema';

async function assertSectorValid(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const found = await sectorsRepo.existsActive(sectorId);
  if (!found) throw HttpError.badRequest('El sector indicado no existe.');
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
  await assertSectorValid(data.sectorId ?? null);
  return repo.create(data);
}

export async function update(id: string, data: UpdateEquipmentInput) {
  await getById(id);
  if (data.sectorId !== undefined) await assertSectorValid(data.sectorId);
  return repo.update(id, data);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
