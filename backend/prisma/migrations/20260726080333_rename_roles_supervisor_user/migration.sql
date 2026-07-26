-- Migracion de datos (no de estructura): se renombran los roles existentes.
-- Se actualizan las filas por su nombre actual, sin tocar sus "id", asi los
-- usuarios ya vinculados a ese rol no pierden el vinculo.
-- Tecnico -> Supervisor: mismo alcance de hoy (ver/gestionar tickets e
-- inventario de toda la empresa), salvo que ya no ve Bitacora tecnica
-- (eso ahora es exclusivo de Administrador, aplicado en el codigo del API).
-- Empleado -> User: sin cambios de fondo, solo el nombre.
UPDATE "roles" SET "name" = 'Supervisor' WHERE "name" = 'Técnico';
UPDATE "roles" SET "name" = 'User' WHERE "name" = 'Empleado';
