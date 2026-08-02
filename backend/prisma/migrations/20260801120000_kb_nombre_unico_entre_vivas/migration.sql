-- El nombre de una base de conocimiento tiene que ser unico ENTRE LAS VIVAS.
-- Con el unique comun, una base eliminada (borrado logico) seguia ocupando su
-- nombre para siempre: al intentar crear otra igual el aviso decia que ya
-- existia, pero el usuario no la veia en ningun lado.
DROP INDEX IF EXISTS "kb_spaces_name_key";

CREATE UNIQUE INDEX "kb_spaces_name_activo_key"
  ON "kb_spaces" ("name")
  WHERE "deleted_at" IS NULL;
