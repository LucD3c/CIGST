import { HttpError } from '../../utils/httpError';
import { buildChangeLine, prependLog } from '../../utils/changeLog';
import { sortByName } from '../../utils/sortByName';
import * as repo from './equipment.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schema';

async function assertSectorValid(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const found = await sectorsRepo.existsActive(sectorId);
  if (!found) throw HttpError.badRequest('El sector indicado no existe.');
}

export async function list(q?: string) {
  return sortByName(await repo.findMany(q), (e) => e.model || e.type);
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

// Cada edicion deja una linea automatica en "Cambios" (changeLog) con el
// antes/despues de lo que se toco: es el log que usan los tecnicos para ver
// el historial de un equipo (y detectar sectores con mucha rotacion).
export async function update(id: string, data: UpdateEquipmentInput) {
  const existing = await getById(id);
  if (data.sectorId !== undefined) await assertSectorValid(data.sectorId);

  let newSectorName: string | null = existing.sector?.name ?? null;
  if (data.sectorId !== undefined) {
    newSectorName = data.sectorId ? (await sectorsRepo.findById(data.sectorId))?.name ?? null : null;
  }

  const line = buildChangeLine([
    { label: 'Tipo', before: existing.type, after: data.type ?? existing.type },
    { label: 'Modelo', before: existing.model, after: data.model ?? existing.model },
    { label: 'Sector', before: existing.sector?.name ?? null, after: newSectorName },
    { label: 'Estado', before: existing.status, after: data.status ?? existing.status },
  ]);

  const patch: UpdateEquipmentInput & { changeLog?: string } = { ...data };
  if (line) patch.changeLog = prependLog(existing.changeLog, line);
  return repo.update(id, patch);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
