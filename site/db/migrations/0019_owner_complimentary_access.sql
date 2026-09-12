-- 0019_owner_complimentary_access.sql — Explicit complimentary-access flag
-- (Ranch Manager Pro). Complimentary ONLY: operations.is_complimentary column
-- plus operation_entitlements audit table. No password_reset tables are
-- created by this migration. Additive only, idempotent with IF NOT EXISTS
-- guards. Nothing is dropped, no existing row is modified, no subscription
-- or billing table is touched.
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';').
-- ---- operations.is_complimentary: explicit owner-granted free access ----
-- Default false. Set ONLY by an explicit audited UPDATE for a specific
-- operation id. It bypasses ONLY future subscription and paywall checks via
-- hasComplimentaryAccess in src/server/entitlement.ts. It never bypasses
-- login, requireAuth, or operation_id data isolation.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS is_complimentary boolean NOT NULL DEFAULT false;
-- ---- operation_entitlements: audit trail for complimentary grants ----
-- One row per grant or revoke event, recording who did it and why. The live
-- flag is operations.is_complimentary, this table is the paper trail.
CREATE TABLE IF NOT EXISTS operation_entitlements (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('complimentary_grant', 'complimentary_revoke')),
  reason       text,
  granted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_entitlements_operation_id_idx ON operation_entitlements (operation_id);
