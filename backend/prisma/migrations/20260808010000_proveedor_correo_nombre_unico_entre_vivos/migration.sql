-- El nombre de un proveedor de correo tiene que ser unico ENTRE LOS VIVOS.
-- Con el unique comun, un proveedor eliminado (borrado logico) seguia ocupando
-- su nombre para siempre: al intentar crear otro igual el aviso decia que ya
-- existia, pero el usuario no lo veia en ningun lado.
DROP INDEX IF EXISTS "mail_providers_name_key";

CREATE UNIQUE INDEX "mail_providers_name_activo_key"
  ON "mail_providers" ("name")
  WHERE "deleted_at" IS NULL;
