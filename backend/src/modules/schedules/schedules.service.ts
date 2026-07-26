import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import * as repo from './schedules.repository';
import type { CreateScheduleInput, UpdateScheduleInput } from './schedules.schema';

function assertRange(startTime: string, endTime: string) {
  if (startTime === endTime) throw HttpError.badRequest('El horario de inicio y fin no pueden ser iguales.');
}

export async function list() {
  return repo.findMany();
}

export async function getById(id: string) {
  const schedule = await repo.findById(id);
  if (!schedule) throw HttpError.notFound('Turno no encontrado.');
  return schedule;
}

export async function create(data: CreateScheduleInput) {
  assertRange(data.startTime, data.endTime);
  try {
    return await repo.create(data);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un turno con ese nombre.');
    throw err;
  }
}

export async function update(id: string, data: UpdateScheduleInput) {
  const existing = await getById(id);
  assertRange(data.startTime ?? existing.startTime, data.endTime ?? existing.endTime);
  try {
    return await repo.update(id, data);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ya existe un turno con ese nombre.');
    throw err;
  }
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
