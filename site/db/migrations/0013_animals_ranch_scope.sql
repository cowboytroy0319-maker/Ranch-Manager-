-- 0013_animals_ranch_scope.sql — Ear-tag uniqueness scoped to ranch/operation
-- (Ranch Manager Pro). The app is single-operation today: one default
-- operation/ranch row is seeded and every animal is backfilled onto it, so
-- tags stay unique within the operation while the schema already supports
-- separate ranches later. One statement per semicolon block; additive and
-- idempotent for the migrate runner and hand re-application.
-- 1. Operations are the ranch/account scope for livestock records. Created
--    before the animals column below so the foreign key can reference it.
CREATE TABLE IF NOT EXISTS operations (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 2. Seed exactly one default operation (single-tenant today). Multiple
--    ranches can be added later; each gets its own tag namespace.
INSERT INTO operations (name) SELECT 'Default Operation' WHERE NOT EXISTS (SELECT 1 FROM operations);
-- 3. Every animal belongs to an operation. NULL until backfilled by step 4.
ALTER TABLE animals ADD COLUMN IF NOT EXISTS ranch_id integer REFERENCES operations(id) ON DELETE CASCADE;
-- 4. Backfill existing rows onto the default operation (idempotent: only rows
--    that are still NULL). Runs before the NOT NULL below sets the guarantee.
UPDATE animals SET ranch_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE ranch_id IS NULL;
-- 5. After the backfill, animals must always carry their operation. Safe here:
--    the single migration transaction guarantees step 4 ran first, and both
--    writers (livestock saveAnimal and db/seed.ts) supply ranch_id now.
ALTER TABLE animals ALTER COLUMN ranch_id SET NOT NULL;
-- 6. Drop the old GLOBAL tag-uniqueness index (the defect: it would forbid the
--    same tag on two different ranches).
DROP INDEX IF EXISTS animals_tag_number_uniq;
-- 7. Tags are unique within each ranch/operation, never across operations.
--    Partial on tag so legacy NULL/blank tags remain allowed, as before.
CREATE UNIQUE INDEX IF NOT EXISTS animals_ranch_tag_uniq
  ON animals (ranch_id, tag_number) WHERE tag_number IS NOT NULL;