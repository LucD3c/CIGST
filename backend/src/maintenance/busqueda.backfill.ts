import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { plainTextOf, type ContentBlock } from '../utils/contentBlocks';

// ---------------------------------------------------------------------------
// Relleno inicial del texto buscable de los articulos.
//
// La migracion crea la columna search_text y le pone el titulo, que es lo unico
// que se puede armar desde SQL. El contenido hay que recorrerlo bloque por
// bloque respetando los campos marcados como ocultos (una contrasena compartida
// no puede quedar en el texto buscable), y eso solo lo sabe hacer el backend.
//
// Corre una sola vez, al arrancar, sobre los articulos que todavia no fueron
// procesados. Se los reconoce porque su texto buscable no tiene salto de linea:
// el que escribe el backend siempre lleva uno entre el titulo y el cuerpo.
// ---------------------------------------------------------------------------

const LOTE = 200;

export async function rellenarBusquedaArticulos(): Promise<number> {
  let procesados = 0;

  try {
    for (;;) {
      const pendientes = await prisma.kbArticle.findMany({
        where: { OR: [{ searchText: null }, { NOT: { searchText: { contains: '\n' } } }] },
        select: {
          id: true,
          title: true,
          blocks: { orderBy: { position: 'asc' }, select: { kind: true, data: true } },
        },
        take: LOTE,
      });

      if (!pendientes.length) break;

      for (const a of pendientes) {
        const cuerpo = plainTextOf(a.blocks as unknown as ContentBlock[]);
        const texto = `${a.title}\n${cuerpo}`.toLowerCase().slice(0, 100000);
        await prisma.kbArticle.update({ where: { id: a.id }, data: { searchText: texto } });
        procesados += 1;
      }

      // Si el lote vino incompleto, ya no queda nada por hacer.
      if (pendientes.length < LOTE) break;
    }

    if (procesados > 0) {
      logger.info({ procesados }, 'Texto de busqueda de articulos actualizado.');
    }
  } catch (err) {
    // Que falle el relleno no puede impedir que la plataforma arranque: la
    // busqueda por titulo sigue funcionando igual mientras tanto.
    logger.error({ err }, 'No se pudo completar el relleno del texto de busqueda de articulos.');
  }

  return procesados;
}
