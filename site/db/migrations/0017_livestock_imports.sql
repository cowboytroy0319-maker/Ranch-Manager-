-- 0017_livestock_imports.sql — Livestock CSV import audit log (Ranch Manager Pro)
-- Additive ONLY: creates ONE new table (livestock_imports) that records every
-- completed (or rolled-back) livestock CSV import per operation. Nothing on
-- existing tables is altered; no Default-Operation fallback is introduced —
-- every query that reads/writes this table carries operation_id. NOT applied
-- to live Neon yet — the lead applies it for separate approval.
--
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';'). Idempotent
-- with IF NOT EXISTS guards. The raw uploaded file is NEVER stored — only the
-- fingerprint (SHA-256 of the normalized CSV) and derived row counts persist.
CREATE TABLE IF NOT EXISTS livestock_imports (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id  integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  fingerprint   text NOT NULL,
  total_rows    integer NOT NULL,
  imported_rows integer NOT NULL,
  skipped_rows  integer NOT NULL,
  excluded_rows integer NOT NULL,
  status        text NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed', 'rolled-back')),
  created_at    timestamptz NOT NULL DEFAULT now()
  -- Duplicate-import detection is intentionally APPLICATION-LAYER ONLY (a
  -- check-before-commit against the most recent 'completed' row for the same
  -- fingerprint), NOT a DB unique constraint: an owner who explicitly confirms
  -- "Import anyway?" must be able to re-import (and get a second truthful
  -- audit row). A unique index here would turn the acknowledged re-import into
  -- a rollback, which the spec forbids (never auto-skip, never silently
  -- duplicate — but always allow the explicit choice).
);
CREATE INDEX IF NOT EXISTS livestock_imports_operation_id_idx
  ON livestock_imports (operation_id);
CREATE INDEX IF NOT EXISTS livestock_imports_created_at_idx
  ON livestock_imports (created_at);