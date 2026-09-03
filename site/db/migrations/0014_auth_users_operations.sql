-- 0014_auth_users_operations.sql — Accounts, sessions, and operation-level data isolation
-- (Ranch Manager Pro, private beta). Additive + scoping only: creates the auth
-- tables (users, operation_memberships, sessions), then adds operation_id to every
-- operational table so each account sees only its own operation's data. Any
-- pre-existing rows are backfilled onto the existing 'Default Operation' row
-- (idempotent after 0013), so internal/demo data stays visible inside that
-- operation. One statement per semicolon-terminated block, no semicolons inside
-- comments (the migrate runner strips comment lines, then splits on ';').
-- NOT applied to live Neon yet — the lead applies it for separate approval.

-- Emails are stored lowercase, normalized at the application layer; the UNIQUE
-- constraint on email is the enforcement backstop. Sessions store only the
-- SHA-256 hash of the token — never the raw token.
CREATE TABLE IF NOT EXISTS users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_memberships (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'worker', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- ---- operation_id scoping on the operational tables (backfill then SET
-- NOT NULL where the table is customer-facing; the Default Operation absorbs
-- all pre-existing rows) ----

ALTER TABLE herd_groups ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE herd_groups SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE herd_groups ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS herd_groups_operation_id_idx ON herd_groups (operation_id);

ALTER TABLE hay_inventory ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE hay_inventory SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE hay_inventory ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS hay_inventory_operation_id_idx ON hay_inventory (operation_id);

ALTER TABLE feed_inventory ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE feed_inventory SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE feed_inventory ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS feed_inventory_operation_id_idx ON feed_inventory (operation_id);

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE usage_log SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE usage_log ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS usage_log_operation_id_idx ON usage_log (operation_id);

ALTER TABLE pastures ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE pastures SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE pastures ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS pastures_operation_id_idx ON pastures (operation_id);

ALTER TABLE pasture_assignments ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE pasture_assignments SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE pasture_assignments ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS pasture_assignments_operation_id_idx ON pasture_assignments (operation_id);

ALTER TABLE grazing_log ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE grazing_log SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE grazing_log ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS grazing_log_operation_id_idx ON grazing_log (operation_id);

ALTER TABLE pasture_observations ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE pasture_observations SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE pasture_observations ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS pasture_observations_operation_id_idx ON pasture_observations (operation_id);

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE equipment SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE equipment ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_operation_id_idx ON equipment (operation_id);

ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE maintenance_records SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE maintenance_records ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS maintenance_records_operation_id_idx ON maintenance_records (operation_id);

ALTER TABLE fuel_log ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE fuel_log SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE fuel_log ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS fuel_log_operation_id_idx ON fuel_log (operation_id);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE expenses SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE expenses ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_operation_id_idx ON expenses (operation_id);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE employees SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE employees ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS employees_operation_id_idx ON employees (operation_id);

ALTER TABLE tax_exemptions ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE tax_exemptions SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
ALTER TABLE tax_exemptions ALTER COLUMN operation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS tax_exemptions_operation_id_idx ON tax_exemptions (operation_id);

-- Stripe events are billed to the paying customer; keep them scoped per
-- operation for the billing/ops reporting view.
ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS operation_id integer REFERENCES operations(id) ON DELETE CASCADE;
UPDATE subscription_events SET operation_id = (SELECT id FROM operations ORDER BY id LIMIT 1) WHERE operation_id IS NULL;
CREATE INDEX IF NOT EXISTS subscription_events_operation_id_idx ON subscription_events (operation_id);

-- Global/diagnostic tables that are deliberately NOT scoped: operations,
-- users, operation_memberships, sessions, animals (scoped via ranch_id since
-- migration 0013), health_events (scoped via their animal),
-- page_views, subscribers, app_settings.