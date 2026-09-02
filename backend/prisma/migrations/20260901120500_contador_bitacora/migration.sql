-- La bitacora tambien emite codigos correlativos (BIT-001): se le siembra su
-- contador con el mismo criterio que los demas.
INSERT INTO "counters" ("prefix", "value")
SELECT 'BIT', GREATEST(
    (SELECT COUNT(*) FROM "logbook_entries"),
    COALESCE((SELECT MAX(CAST(SUBSTRING("code" FROM '[0-9]+$') AS INTEGER))
              FROM "logbook_entries" WHERE "code" ~ '^BIT-[0-9]+$'), 0)
)
ON CONFLICT ("prefix") DO NOTHING;
