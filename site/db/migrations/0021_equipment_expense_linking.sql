-- 0021_equipment_expense_linking.sql — Equipment expense linking (financial
-- workflow audit Phase 2, defects D1 + D3 + the linked-fuel model): adds the
-- per-operation idempotency key to maintenance_records and fuel_log so a
-- double-tap or retry can never duplicate a service record or a fill-up.
-- Mirrors the uq_restock_log_operation_request pattern from
-- 0018_product_blocker.sql: uniqueness is PER OPERATION (ranch), never global —
-- two different ranches may reuse the same client_request_id, so the key is
-- only unique inside one operation_id. One statement per semicolon-terminated
-- block, no semicolons inside comments (the migrate runner strips comment
-- lines, then splits on ';').
-- Additive only: new columns + named constraints; nothing is dropped. The
-- (equipment_id) indexes both tables need already exist from 0004_equipment.sql
-- (maintenance_equipment_idx, fuel_log_equipment_idx), so none are added here.
-- The linked-expense write path itself needs NO schema change: the partial
-- unique index expenses_source_once_uniq (0018) already backs exactly-once for
-- ANY source_type, including the new 'maintenance' and 'fuel_log' values.
--
-- PRODUCTION-SHAPED BACKFILL (the 0018 lesson): production and the preview
-- carry maintenance/fuel history written before this key existed. CI builds
-- databases empty, so a NOT NULL + UNIQUE landing on legacy rows is exactly
-- the class of failure CI cannot see. Every existing row therefore gets a
-- generated value no other row can hold BEFORE the NOT NULL and the UNIQUE
-- constraint are applied: 'legacy-<id>-<random>' — the row's id is globally
-- unique, so the value is unique inside every operation.

-- ---- maintenance_records: client_request_id (per-operation idempotency) ----
ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS client_request_id text;
-- Backfill legacy rows first — each value embeds the row id, so it cannot
-- collide with another row's value in any operation.
UPDATE maintenance_records
  SET client_request_id = 'legacy-' || id::text || '-' || md5(random()::text)
  WHERE client_request_id IS NULL;
ALTER TABLE maintenance_records ALTER COLUMN client_request_id SET NOT NULL;
ALTER TABLE maintenance_records
  ADD CONSTRAINT uq_maintenance_records_operation_request
  UNIQUE (operation_id, client_request_id);

-- ---- fuel_log: the same key, the same shape ----
ALTER TABLE fuel_log ADD COLUMN IF NOT EXISTS client_request_id text;
UPDATE fuel_log
  SET client_request_id = 'legacy-' || id::text || '-' || md5(random()::text)
  WHERE client_request_id IS NULL;
ALTER TABLE fuel_log ALTER COLUMN client_request_id SET NOT NULL;
ALTER TABLE fuel_log
  ADD CONSTRAINT uq_fuel_log_operation_request
  UNIQUE (operation_id, client_request_id);
