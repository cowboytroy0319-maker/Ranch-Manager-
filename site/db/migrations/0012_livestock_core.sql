-- 0012_livestock_core.sql — Livestock record foundation (Ranch Manager Pro)
-- Acquisition date, culled/archived statuses, and unique tags within the ranch.
-- One statement per semicolon-terminated block; additive + idempotent so the
-- migrate runner (db/migrate.ts) tolerates re-runs on fresh or seeded DBs.

-- 1. Acquisition date (when the animal joined the operation). Optional, like
--    birth_date; NULL until the operator records it.
ALTER TABLE animals ADD COLUMN IF NOT EXISTS acquisition_date date;

-- 2. Widen the status allow-list. The runner tracks applied migrations, but
--    DROP + re-ADD is written to be safe if this file is re-applied by hand.
--    Existing rows only ever contain active/pending/sold/deceased, all of
--    which are still allowed by the new CHECK.
ALTER TABLE animals DROP CONSTRAINT IF EXISTS animals_status_check;
ALTER TABLE animals ADD CONSTRAINT animals_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'deceased', 'culled', 'archived'));

-- 3. Tags are unique within the ranch. Partial index: NULL/empty tags are
--    allowed for legacy rows, but any recorded tag can appear at most once.
CREATE UNIQUE INDEX IF NOT EXISTS animals_tag_number_uniq
  ON animals (tag_number) WHERE tag_number IS NOT NULL;