-- Orden alfabetico correcto EN LA BASE DE DATOS.
--
-- Postgres compara texto por codigo de caracter salvo que se le diga otra cosa,
-- y asi "Zapata" queda antes que "alvarez" y los acentos van todos al final.
-- Hasta ahora eso se corregia reordenando en Node despues de traer la tabla
-- entera, truco que deja de servir en cuanto los listados se paginan: no se
-- puede ordenar bien un universo del que solo se trajo una pagina.
--
-- La solucion definitiva es marcar las columnas de texto con la colacion
-- espaniola, para que el orden correcto salga directamente de la consulta.
-- Se usa "es-x-icu" (espaniol generico, no de un pais puntual) para que la
-- plataforma sirva igual en cualquier empresa de habla hispana.

ALTER TABLE "employees"       ALTER COLUMN "name"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "equipment"       ALTER COLUMN "model" TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "equipment"       ALTER COLUMN "type"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "sectors"         ALTER COLUMN "name"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "tickets"         ALTER COLUMN "title" TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "users"           ALTER COLUMN "name"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "schedules"       ALTER COLUMN "name"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "logbook_entries" ALTER COLUMN "title" TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "kb_spaces"       ALTER COLUMN "name"  TYPE TEXT COLLATE "es-x-icu";
ALTER TABLE "kb_articles"     ALTER COLUMN "title" TYPE TEXT COLLATE "es-x-icu";
