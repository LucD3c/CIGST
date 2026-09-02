import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import { buildChangeLine, prependLog } from '../../utils/changeLog';
import { sortByName } from '../../utils/sortByName';
import * as repo from './equipment.repository';
import * as sectorsRepo from '../sectors/sectors.repository';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment.schema';
import { armarPagina, ordenar, saltear, type PaginationQuery } from '../../utils/pagination';

async function assertSectorValid(sectorId: string | null | undefined) {
  if (!sectorId) return;
  const found = await sectorsRepo.existsActive(sectorId);
  if (!found) throw HttpError.badRequest('El sector indicado no existe.');
}

export async function list(q?: string) {
  return sortByName(await repo.findMany(q), (e) => e.model || e.type);
}

const ORDEN: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown> | Record<string, unknown>[]> = {
  model: (d) => [{ model: d }, { type: d }],
  code: (d) => ({ code: d }),
  type: (d) => ({ type: d }),
  status: (d) => ({ status: d }),
  sectorName: (d) => ({ sector: { name: d } }),
};

export async function listarPagina(query: PaginationQuery) {
  const where = repo.filtroBusqueda(query.q);
  const orderBy = ordenar(ORDEN, query.sort, query.dir, [{ model: 'asc' }, { type: 'asc' }]);
  const { items, total } = await repo.findPage(where, saltear(query.page, query.pageSize), query.pageSize, orderBy);
  return armarPagina(items, total, query.page, query.pageSize);
}

export async function getById(id: string) {
  const equipment = await repo.findById(id);
  if (!equipment) throw HttpError.notFound('Equipo no encontrado.');
  return equipment;
}

// Comprueba que un codigo escrito a mano no choque con otro ya existente. Se
// mira tambien entre los dados de baja: el codigo es unico en toda la tabla, y
// avisar antes es mucho mejor que un error de base de datos.
async function assertCodigoLibre(code: string, excepto?: string) {
  const ocupado = await repo.codigoOcupado(code, excepto);
  if (!ocupado) return;
  const cual = ocupado.model || ocupado.type;
  throw HttpError.conflict(
    ocupado.deletedAt
      ? `El código "${code}" ya lo usó "${cual}", que está dado de baja. Elegí otro código.`
      : `El código "${code}" ya lo tiene "${cual}". Elegí otro.`,
  );
}

export async function create(data: CreateEquipmentInput) {
  await assertSectorValid(data.sectorId ?? null);
  if (data.code && data.code.trim()) await assertCodigoLibre(data.code.trim());
  try {
    return await repo.create(data);
  } catch (err) {
    // Red de contencion por si dos altas con el mismo codigo manual entran a la
    // vez y las dos pasan la comprobacion de arriba.
    if (isUniqueConstraintError(err)) {
      throw HttpError.conflict('Ese código ya está en uso por otro equipo o espacio. Elegí otro.');
    }
    throw err;
  }
}

// Cada edicion deja una linea automatica en "Cambios" (changeLog) con el
// antes/despues de lo que se toco: es el log que usan los tecnicos para ver
// el historial de un equipo (y detectar sectores con mucha rotacion).
export async function update(id: string, data: UpdateEquipmentInput) {
  const existing = await getById(id);
  if (data.sectorId !== undefined) await assertSectorValid(data.sectorId);
  if (data.code !== undefined && data.code !== existing.code) await assertCodigoLibre(data.code, id);

  let newSectorName: string | null = existing.sector?.name ?? null;
  if (data.sectorId !== undefined) {
    newSectorName = data.sectorId ? (await sectorsRepo.findById(data.sectorId))?.name ?? null : null;
  }

  const line = buildChangeLine([
    { label: 'Código', before: existing.code, after: data.code ?? existing.code },
    { label: 'Tipo', before: existing.type, after: data.type ?? existing.type },
    { label: 'Modelo', before: existing.model, after: data.model ?? existing.model },
    { label: 'Sector', before: existing.sector?.name ?? null, after: newSectorName },
    { label: 'Estado', before: existing.status, after: data.status ?? existing.status },
  ]);

  const patch: UpdateEquipmentInput & { changeLog?: string } = { ...data };
  if (line) patch.changeLog = prependLog(existing.changeLog, line);
  try {
    return await repo.update(id, patch);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw HttpError.conflict('Ese código ya está en uso por otro equipo o espacio. Elegí otro.');
    }
    throw err;
  }
}

export async function remove(id: string) {
  await getById(id);
  return repo.softDelete(id);
}
