import { HttpError } from '../../utils/httpError';
import { buildChangeLine, prependLog } from '../../utils/changeLog';
import { workingStatus } from '../../utils/workingHours';
import { sortByName } from '../../utils/sortByName';
import * as repo from './employees.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import * as equipmentRepo from '../equipment/equipment.repository';
import type { CreateEmployeeInput, UpdateEmployeeInput } from './employees.schema';
import { armarPagina, ordenar, saltear, type PaginationQuery } from '../../utils/pagination';

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

// Agrega el estado "en linea / fuera de horario" calculado con la hora del
// servidor, para que todos vean lo mismo sin depender del reloj de su equipo.
function withWorkingStatus<T extends { workStartTime: string | null; workEndTime: string | null }>(employee: T) {
  return { ...employee, workingStatus: workingStatus(employee.workStartTime, employee.workEndTime) };
}

export async function list(q?: string) {
  const employees = await repo.findMany(q);
  return sortByName(employees.map(withWorkingStatus), (e) => e.name);
}

// El orden ya lo resuelve Postgres con la colacion espaniola: no hace falta
// reordenar en Node (algo que ademas seria incorrecto sobre una sola pagina).
const ORDEN: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>> = {
  name: (d) => ({ name: d }),
  code: (d) => ({ code: d }),
  email: (d) => ({ email: d }),
  extension: (d) => ({ extension: d }),
  sectorName: (d) => ({ sector: { name: d } }),
  status: (d) => ({ status: d }),
};

export async function listarPagina(query: PaginationQuery) {
  const where = repo.filtroBusqueda(query.q);
  const orderBy = ordenar(ORDEN, query.sort, query.dir, { name: 'asc' });
  const { items, total } = await repo.findPage(where, saltear(query.page, query.pageSize), query.pageSize, orderBy);
  return armarPagina(items.map(withWorkingStatus), total, query.page, query.pageSize);
}

// La ficha de persona muestra el equipamiento de su mismo sector (ya no hay
// vinculo directo persona-equipo: el equipo se asigna a un sector, no a un
// individuo).
export async function getById(id: string) {
  const employee = await repo.findById(id);
  if (!employee) throw HttpError.notFound('Persona no encontrada.');
  const sectorEquipment = employee.sectorId ? await equipmentRepo.findBySector(employee.sectorId) : [];
  return { ...withWorkingStatus(employee), sectorEquipment };
}

export async function create(data: CreateEmployeeInput) {
  await assertReplacementValid(data.replacementId ?? null);
  await assertSectorValid(data.sectorId ?? null);
  return repo.create(data);
}

// Cada edicion deja una linea automatica en el historial de Cambios de la
// persona ("de X a Y", con fecha y hora), visible para Admin y Supervisor.
export async function update(id: string, data: UpdateEmployeeInput) {
  const existing = await getById(id);
  if (data.replacementId !== undefined) await assertReplacementValid(data.replacementId, id);
  if (data.sectorId !== undefined) await assertSectorValid(data.sectorId);

  let newSectorName: string | null = existing.sector?.name ?? null;
  if (data.sectorId !== undefined) {
    newSectorName = data.sectorId ? (await sectorsRepo.findById(data.sectorId))?.name ?? null : null;
  }
  let newReplacementName: string | null = existing.replacement?.name ?? null;
  if (data.replacementId !== undefined) {
    newReplacementName = data.replacementId ? (await repo.findById(data.replacementId))?.name ?? null : null;
  }

  const after = <K extends keyof UpdateEmployeeInput>(key: K, current: string | null | undefined) =>
    data[key] !== undefined ? (data[key] as string | null | undefined) : current;

  const line = buildChangeLine([
    { label: 'Nombre', before: existing.name, after: after('name', existing.name) },
    { label: 'Correo', before: existing.email, after: after('email', existing.email) },
    { label: 'Teléfono', before: existing.phone, after: after('phone', existing.phone) },
    { label: 'Interno', before: existing.extension, after: after('extension', existing.extension) },
    { label: 'Sector', before: existing.sector?.name ?? null, after: newSectorName },
    { label: 'Cargo', before: existing.position, after: after('position', existing.position) },
    { label: 'Turno laboral', before: existing.workShift, after: after('workShift', existing.workShift) },
    { label: 'Horario', before: existing.schedule, after: after('schedule', existing.schedule) },
    { label: 'Reemplazo', before: existing.replacement?.name ?? null, after: newReplacementName },
    { label: 'Estado', before: existing.status, after: after('status', existing.status) },
    { label: 'Observaciones', before: existing.notes, after: after('notes', existing.notes) },
  ]);

  const patch: UpdateEmployeeInput & { changeLog?: string } = { ...data };
  if (line) patch.changeLog = prependLog(existing.changeLog, line);
  return repo.update(id, patch);
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
