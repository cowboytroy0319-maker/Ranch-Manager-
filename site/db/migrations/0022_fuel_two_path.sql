-- 0022_fuel_two_path.sql — the owner's two-path fuel model (directive quoted
-- 2026-10-20): a fuel PURCHASE creates exactly ONE linked Fuel expense; fuel
-- DRAWN from an already-purchased bulk tank records USAGE ONLY and never a
-- second expense; editing/voiding a purchase updates/reverses the SAME linked
-- expense. fuel_log gains the discriminator that makes the split possible:
--
--   record_kind = 'purchase'  money leaves at this record (station fill-up OR
--                             bulk-tank delivery) — the one expensed path
--   record_kind = 'draw'      inventory consumption from a tank already bought
--                             — usage only, never an expense
--
-- Additive only, mirroring 0018/0021: a new column + a named CHECK, nothing
-- dropped, 0018 untouched. LEGACY BACKFILL: every existing row becomes a
-- 'purchase' — rows written before this migration lived on the single-path
-- branch that expensed every fill-up it recorded, so marking any of them
-- 'draw' would orphan its linked ledger row and break the exactly-once money
-- story. The DEFAULT covers the ADD COLUMN rewrite; the explicit UPDATE is
-- the belt-and-braces backfill in the 0021 shape (idempotent, and it covers a
-- re-run against a table where the column already arrived without the
-- default). One statement per semicolon block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';').
ALTER TABLE fuel_log ADD COLUMN IF NOT EXISTS record_kind text DEFAULT 'purchase';
UPDATE fuel_log SET record_kind = 'purchase' WHERE record_kind IS NULL;
ALTER TABLE fuel_log ALTER COLUMN record_kind SET NOT NULL;
ALTER TABLE fuel_log ADD CONSTRAINT fuel_log_record_kind_check CHECK (record_kind IN ('purchase','draw'));
