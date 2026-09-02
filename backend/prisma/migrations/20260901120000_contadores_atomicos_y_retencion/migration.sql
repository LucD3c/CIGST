-- Contador atomico para los codigos legibles (TK-001, EMP-001, EQ-001...).
-- Reemplaza al viejo count()+1, que con dos altas simultaneas producia el
-- mismo codigo y hacia fallar a la segunda contra el indice unico.
CREATE TABLE "counters" (
    "prefix" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "counters_pkey" PRIMARY KEY ("prefix")
);

-- Se siembra cada contador con el valor mas alto entre (a) la cantidad de
-- filas existentes -que es lo que devolvia el count() anterior- y (b) el
-- numero mas alto que aparece en los codigos ya emitidos. Asi la numeracion
-- continua donde estaba y nunca repite un codigo ya usado.
INSERT INTO "counters" ("prefix", "value")
SELECT 'TK', GREATEST(
    (SELECT COUNT(*) FROM "tickets"),
    COALESCE((SELECT MAX(CAST(SUBSTRING("code" FROM '[0-9]+$') AS INTEGER))
              FROM "tickets" WHERE "code" ~ '^TK-[0-9]+$'), 0)
);

INSERT INTO "counters" ("prefix", "value")
SELECT 'EMP', GREATEST(
    (SELECT COUNT(*) FROM "employees"),
    COALESCE((SELECT MAX(CAST(SUBSTRING("code" FROM '[0-9]+$') AS INTEGER))
              FROM "employees" WHERE "code" ~ '^EMP-[0-9]+$'), 0)
);

INSERT INTO "counters" ("prefix", "value")
SELECT 'EQ', GREATEST(
    (SELECT COUNT(*) FROM "equipment"),
    COALESCE((SELECT MAX(CAST(SUBSTRING("code" FROM '[0-9]+$') AS INTEGER))
              FROM "equipment" WHERE "code" ~ '^EQ-[0-9]+$'), 0)
);

-- Intentos fallidos de inicio de sesion: van a la base para que el bloqueo
-- por fuerza bruta sobreviva a un reinicio del contenedor.
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_username_created_at_idx" ON "login_attempts"("username", "created_at");
CREATE INDEX "login_attempts_ip_address_created_at_idx" ON "login_attempts"("ip_address", "created_at");
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");

-- Indices para que las listas paginadas no escaneen la tabla entera.
CREATE INDEX "tickets_deleted_at_created_at_idx" ON "tickets"("deleted_at", "created_at");
CREATE INDEX "employees_deleted_at_name_idx" ON "employees"("deleted_at", "name");
CREATE INDEX "equipment_deleted_at_model_idx" ON "equipment"("deleted_at", "model");
CREATE INDEX "logbook_entries_deleted_at_occurred_at_idx" ON "logbook_entries"("deleted_at", "occurred_at");
CREATE INDEX "kb_articles_deleted_at_updated_at_idx" ON "kb_articles"("deleted_at", "updated_at");
