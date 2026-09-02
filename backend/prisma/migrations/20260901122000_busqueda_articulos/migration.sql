-- Busqueda dentro del contenido de los articulos, resuelta por la base.
--
-- Antes la busqueda traia hasta 500 articulos a memoria y los filtraba ahi:
-- pasados los 500, los que quedaban afuera no aparecian NUNCA en ninguna
-- busqueda, y nadie se enteraba porque no habia ningun aviso.
--
-- La columna guarda el texto plano del articulo tal como lo arma plainTextOf(),
-- que EXCLUYE los campos marcados como ocultos. Eso importa: en las bases de
-- conocimiento se guardan credenciales compartidas en campos ocultos, y si el
-- texto buscable las incluyera, cualquiera podria encontrar un articulo
-- buscando una contrasena.
ALTER TABLE "kb_articles" ADD COLUMN "search_text" TEXT;

-- pg_trgm permite indexar busquedas por "contiene" (LIKE '%algo%'), que sin
-- indice obligan a recorrer la tabla entera.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "kb_articles_search_text_idx" ON "kb_articles" USING GIN ("search_text" gin_trgm_ops);

-- Relleno inicial con el titulo, que es lo unico que se puede reconstruir en
-- SQL sin interpretar los bloques. El contenido completo lo escribe el backend
-- al arrancar (ver rellenarBusquedaArticulos), que si sabe distinguir los
-- campos ocultos.
UPDATE "kb_articles" SET "search_text" = lower("title") WHERE "search_text" IS NULL;
