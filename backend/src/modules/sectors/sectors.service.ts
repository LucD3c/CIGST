import { HttpError } from '../../utils/httpError';
import { isUniqueConstraintError } from '../../utils/prismaErrors';
import { sortByName } from '../../utils/sortByName';
import * as repo from './sectors.repository';
import * as employeesRepo from '../employees/employees.repository';
import * as equipmentRepo from '../equipment/equipment.repository';
import type { CreateSectorInput, UpdateSectorInput, CreateCategoryInput } from './sectors.schema';

export async function list(q?: string) {
  return sortByName(await repo.findMany(q), (s) => s.name);
}

// El detalle de un sector muestra quienes lo integran (personas y equipos),
// para poder administrar "quien esta en que sector" desde un solo lugar.
export async function getById(id: string) {
  const sector = await repo.findById(id);
  if (!sector) throw HttpError.notFound('Sector no encontrado.');
  const [people, equipment, categories] = await Promise.all([
    employeesRepo.findBySector(id),
    equipmentRepo.findBySector(id),
    repo.findCategories(id),
  ]);
  return {
    ...sector,
    people: sortByName(people, (e) => e.name),
    equipment: sortByName(equipment, (e) => e.model || e.type),
    categories: sortByName(categories, (c) => c.name),
  };
}

/* ---------- Categorias de ticket del sector ---------- */

export async function addCategory(sectorId: string, data: CreateCategoryInput) {
  await getById(sectorId);
  try {
    return await repo.createCategory(sectorId, data.name);
  } catch (err) {
    if (isUniqueConstraintError(err)) throw HttpError.conflict('Ese sector ya tiene una categoría con ese nombre.');
    throw err;
  }
}

export async function removeCategory(sectorId: string, categoryId: string) {
  const category = await repo.findCategoryById(categoryId);
  if (!category || category.sectorId !== sectorId) {
    throw HttpError.notFound('Categoría no encontrada en este sector.');
  }
  // Los tickets guardan el NOMBRE de la categoria, no su id: borrarla no
  // afecta el historial ya cargado, solo deja de ofrecerse en el formulario.
  await repo.deleteCategory(categoryId);
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

// No se elimina un sector que todavia tiene gente o equipos adentro: quedarian
// apuntando a un sector que ya no existe, la lista seguiria mostrando ese
// nombre y al editar la ficha el desplegable caeria en "Sin definir" sin que
// nadie lo pida. Se avisa cuantos hay y que hacer antes de borrarlo.
export async function remove(id: string) {
  const sector = await getById(id);
  const personas = sector.people.length;
  const equipos = sector.equipment.length;
  if (personas || equipos) {
    const partes: string[] = [];
    if (personas) partes.push(`${personas} ${personas === 1 ? 'persona' : 'personas'}`);
    if (equipos) partes.push(`${equipos} ${equipos === 1 ? 'equipo o espacio' : 'equipos o espacios'}`);
    throw HttpError.conflict(
      `No se puede eliminar «${sector.name}»: todavía tiene ${partes.join(' y ')}. ` +
        'Movelos a otro sector (o dejalos sin sector) y volvé a intentarlo.',
    );
  }
  return repo.softDelete(id);
}
