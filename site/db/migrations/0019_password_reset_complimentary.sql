-- 0019_password_reset_complimentary.sql — Secure password reset plus explicit
-- complimentary-access entitlement (Ranch Manager Pro). Additive only and
-- idempotent with IF NOT EXISTS guards. Nothing is dropped, no existing row
-- is modified, no subscription or billing table is touched.
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';').
-- NOT applied to live Neon yet — the lead applies it after separate approval.

-- ---- password_resets: single-use reset tokens, hash-only server side ----
-- The raw token (32 random bytes, hex-encoded by the app) is NEVER stored.
-- Only its SHA-256 hex digest is persisted in token_hash. A row is usable
-- exactly once: resetPasswordCore sets used_at on success and rejects any
-- row that is expired, already used, or superseded by a newer request.
CREATE TABLE IF NOT EXISTS password_resets (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets (expires_at);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);

-- ---- password_reset_requests: per-email and per-IP rate-limit ledger ----
-- One row per reset request. requestPasswordResetCore counts recent rows to
-- enforce the caps (max 5 per hour per email, max 20 per hour per IP, plus a
-- short per-email cooldown). Rows are write-only telemetry, never read back
-- to the client.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL,
  ip         text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_requests_email_idx ON password_reset_requests (email, created_at);
CREATE INDEX IF NOT EXISTS password_reset_requests_ip_idx ON password_reset_requests (ip, created_at);

-- ---- operations.is_complimentary: explicit owner-granted free access ----
-- Default false. Set ONLY by an explicit audited UPDATE for a specific
-- operation id (see docs or the PR description for the exact statement).
-- It bypasses ONLY future subscription and paywall checks via
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
