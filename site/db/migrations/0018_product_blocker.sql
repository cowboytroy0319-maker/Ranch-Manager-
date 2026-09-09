-- 0018_product_blocker.sql — Product-blocker release: expenses categories,
-- linked-source columns, restock / pasture activity / livestock movement
-- tables (Ranch Manager Pro). Additive + operation-scoped: nothing is dropped,
-- every new row is scoped by operation_id, and category values are remapped
-- in place (old enum values remain valid until they are updated, then the
-- new CHECK is applied — exactly like 0012 did for animal statuses).
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';'). Idempotent
-- with IF EXISTS / IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards.
-- NOT applied to live Neon yet — the lead applies it for separate approval.

-- ---- expenses: 6 → 12 categories ----
-- Remap rows to the new values BEFORE swapping the allow-list, so no row
-- ever sits under the new CHECK with an old value.
UPDATE expenses SET category = 'hay_feed'      WHERE category = 'feed';
UPDATE expenses SET category = 'veterinary'    WHERE category = 'vet_health';
UPDATE expenses SET category = 'repairs_maintenance' WHERE category = 'maintenance';
UPDATE expenses SET category = 'fuel'          WHERE category = 'fuel';
UPDATE expenses SET category = 'insurance'     WHERE category = 'insurance';
UPDATE expenses SET category = 'other'         WHERE category = 'other';
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('hay_feed', 'livestock', 'fuel', 'repairs_maintenance', 'veterinary',
                      'supplies', 'labor', 'utilities', 'land_pasture', 'insurance',
                      'taxes_fees', 'other'));

-- Linked-source metadata: paid_by (who paid), source_type + source_id (the
-- record this expense was auto-created from, e.g. a hay restock or a pasture
-- activity). NULL source_* = a manually entered expense.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_id integer;

-- The exactly-once guarantee for linked expenses: at most ONE expense row can
-- claim a given source record (e.g. one expense per restock, one per pasture
-- activity), backed by the unique index — retries/double-taps cannot create a
-- second expense for the same source.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_source_once_uniq
  ON expenses (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- ---- pastures: optional acreage + status/condition/capacity fields ----
ALTER TABLE pastures ALTER COLUMN size_acres DROP NOT NULL;
ALTER TABLE pastures ADD COLUMN IF NOT EXISTS pasture_type text;
ALTER TABLE pastures ADD COLUMN IF NOT EXISTS capacity_heads integer
  CHECK (capacity_heads IS NULL OR capacity_heads >= 0);
ALTER TABLE pastures ADD COLUMN IF NOT EXISTS water_status text NOT NULL DEFAULT 'unknown'
  CHECK (water_status IN ('good', 'needs_attention', 'unavailable', 'unknown'));
ALTER TABLE pastures ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'good'
  CHECK (condition IN ('excellent', 'good', 'fair', 'poor', 'resting'));

-- ---- restock_log: hay/feed inventory restocks (idempotent via client key) ----
CREATE TABLE IF NOT EXISTS restock_log (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id       integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  item_kind          text NOT NULL CHECK (item_kind IN ('hay', 'feed')),
  hay_item_id        integer REFERENCES hay_inventory(id) ON DELETE SET NULL,
  feed_item_id       integer REFERENCES feed_inventory(id) ON DELETE SET NULL,
  quantity           numeric NOT NULL CHECK (quantity > 0),
  unit               text NOT NULL,
  restock_date       date NOT NULL,
  total_cost_cents   integer CHECK (total_cost_cents IS NULL OR total_cost_cents >= 0),
  vendor             text,
  notes              text,
  client_request_id  text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restock_log_one_item CHECK (
    (hay_item_id IS NOT NULL AND feed_item_id IS NULL)
    OR (hay_item_id IS NULL AND feed_item_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS restock_log_operation_id_idx ON restock_log (operation_id);

-- ---- pasture_activities: work/cost events on a pasture (expense-linked;
--      idempotent via client_request_id, same pattern as restock_log) ----
CREATE TABLE IF NOT EXISTS pasture_activities (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id   integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  pasture_id     integer NOT NULL REFERENCES pastures(id) ON DELETE CASCADE,
  activity_date  date NOT NULL,
  activity_type  text NOT NULL CHECK (activity_type IN ('fencing', 'water_system', 'mowing',
                  'fertilizing', 'spraying', 'reseeding', 'mineral_salt', 'repair',
                  'inspection', 'other')),
  cost_cents     integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  notes          text,
  client_request_id text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pasture_activities_operation_id_idx ON pasture_activities (operation_id);
CREATE INDEX IF NOT EXISTS pasture_activities_pasture_id_idx ON pasture_activities (pasture_id);

-- ---- livestock_movements: group-based movement history ----
CREATE TABLE IF NOT EXISTS livestock_movements (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id    integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  from_pasture_id integer REFERENCES pastures(id) ON DELETE SET NULL,
  to_pasture_id   integer NOT NULL REFERENCES pastures(id) ON DELETE CASCADE,
  move_date       date NOT NULL,
  herd_group_id   integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  head_count      integer CHECK (head_count IS NULL OR head_count >= 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS livestock_movements_operation_id_idx ON livestock_movements (operation_id);
CREATE INDEX IF NOT EXISTS livestock_movements_to_pasture_idx ON livestock_movements (to_pasture_id);