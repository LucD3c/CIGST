-- Unidades de red: carpetas compartidas (SMB/Samba) que ya existen en un
-- servidor de archivos de la empresa, vinculadas a la plataforma. Solo se
-- agregan tablas nuevas: no se modifica ni se borra ningun dato existente.

-- CreateTable
CREATE TABLE "network_drives" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "share" TEXT NOT NULL,
    "base_path" TEXT NOT NULL DEFAULT '',
    "domain" TEXT,
    "auth_user" TEXT NOT NULL,
    "secret_cipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "network_drives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_drive_access" (
    "id" TEXT NOT NULL,
    "drive_id" TEXT NOT NULL,
    "user_id" TEXT,
    "sector_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_drive_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_drive_events" (
    "id" TEXT NOT NULL,
    "drive_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_drive_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_drive_access_drive_id_idx" ON "network_drive_access"("drive_id");

-- CreateIndex
CREATE INDEX "network_drive_access_user_id_idx" ON "network_drive_access"("user_id");

-- CreateIndex
CREATE INDEX "network_drive_access_sector_id_idx" ON "network_drive_access"("sector_id");

-- CreateIndex
CREATE INDEX "network_drive_events_drive_id_created_at_idx" ON "network_drive_events"("drive_id", "created_at");

-- Una misma persona (o un mismo sector) no puede figurar dos veces en la
-- lista de acceso de una unidad. Son indices parciales porque cada fila tiene
-- uno solo de los dos campos.
CREATE UNIQUE INDEX "network_drive_access_drive_user_key"
  ON "network_drive_access" ("drive_id", "user_id")
  WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "network_drive_access_drive_sector_key"
  ON "network_drive_access" ("drive_id", "sector_id")
  WHERE "sector_id" IS NOT NULL;

-- Cada fila de acceso apunta a una persona O a un sector, nunca a los dos ni
-- a ninguno.
ALTER TABLE "network_drive_access" ADD CONSTRAINT "network_drive_access_destino_check"
  CHECK (("user_id" IS NULL) <> ("sector_id" IS NULL));

-- AddForeignKey
ALTER TABLE "network_drives" ADD CONSTRAINT "network_drives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_drive_access" ADD CONSTRAINT "network_drive_access_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "network_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_drive_access" ADD CONSTRAINT "network_drive_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_drive_access" ADD CONSTRAINT "network_drive_access_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_drive_events" ADD CONSTRAINT "network_drive_events_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "network_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_drive_events" ADD CONSTRAINT "network_drive_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
