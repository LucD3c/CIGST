import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import * as repo from './sectors.repository';
import * as employeesRepo from '../employees/employees.repository';
import * as equipmentRepo from '../equipment/equipment.repository';
import type { CreateSectorInput, UpdateSectorInput } from './sectors.schema';

export async function list(q?: string) {
  return repo.findMany(q);
}

// El detalle de un sector muestra quienes lo integran (personas y equipos),
// para poder administrar "quien esta en que sector" desde un solo lugar.
export async function getById(id: string) {
  const sector = await repo.findById(id);
  if (!sector) throw HttpError.notFound('Sector no encontrado.');
  const [people, equipment] = await Promise.all([
    employeesRepo.findBySector(id),
    equipmentRepo.findBySector(id),
  ]);
  return { ...sector, people, equipment };
}

export async function create(data: CreateSectorInput) {
  try {
    return await repo.create(data);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un sector con ese nombre.');
    throw err;
  }
}

export async function update(id: string, data: UpdateSectorInput) {
  await getById(id);
  try {
    return await repo.update(id, data);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un sector con ese nombre.');
    throw err;
  }
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
