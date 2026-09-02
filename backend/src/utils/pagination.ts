import { z } from 'zod';

// ---------------------------------------------------------------------------
// Paginacion de listados.
//
// Antes cada listado devolvia la tabla ENTERA con todas sus relaciones, en cada
// carga de pantalla. Con 26 tickets eso es instantaneo; con quince mil son
// varios megabytes de JSON por persona y por pantalla, y setenta personas
// trabajando a la vez lo convierten en un problema serio. Ahora el servidor
// devuelve de a una pagina y dice cuantos hay en total.
//
// El tope duro de 200 por pagina no es negociable desde el cliente: aunque
// alguien pida pageSize=100000, el servidor entrega 200. Es lo que garantiza
// que ninguna consulta pueda crecer sin limite con el paso de los anios.
// ---------------------------------------------------------------------------

export const PAGE_SIZE_POR_DEFECTO = 50;
export const PAGE_SIZE_MAXIMO = 200;

export const paginationQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAXIMO).default(PAGE_SIZE_POR_DEFECTO),
  sort: z.string().trim().max(50).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
  // Filtro de estado de los tickets. Con la lista paginada ya no puede
  // resolverse en el navegador: si el filtro se aplicara sobre una sola pagina,
  // el resultado seria "los activos que hay entre los primeros 50", no "los
  // activos".
  estado: z.string().trim().max(40).optional(),
  // Tickets de una persona o de un equipo concreto: lo usan las fichas de
  // detalle, que antes filtraban sobre la lista completa que tenia cargada el
  // navegador. Con paginacion esa lista ya no esta completa, asi que el filtro
  // tiene que hacerlo la base.
  employeeId: z.string().uuid().optional(),
  equipmentId: z.string().uuid().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Pagina<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

export function armarPagina<T>(items: T[], total: number, page: number, pageSize: number): Pagina<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function saltear(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

/**
 * Traduce el nombre de columna que manda el cliente a un `orderBy` de Prisma,
 * usando un mapa explicito por modulo. Si el nombre no esta en el mapa se cae
 * al orden por defecto: asi el cliente NUNCA puede ordenar por una columna
 * arbitraria ni inyectar nada en la consulta.
 */
export function ordenar<T>(
  mapa: Record<string, (dir: 'asc' | 'desc') => T>,
  sort: string | undefined,
  dir: 'asc' | 'desc',
  porDefecto: T,
): T {
  if (!sort) return porDefecto;
  const constructor = mapa[sort];
  return constructor ? constructor(dir) : porDefecto;
}
