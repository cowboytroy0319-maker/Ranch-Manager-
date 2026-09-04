-- 0016_operation_onboarding.sql — Operation setup/profile for customer onboarding
-- (Ranch Manager Pro, phase 16). Additive only: creates ONE new scoped table
-- (operation_profile) AND adds nullable setup columns to the existing
-- `operations` table. Nothing is dropped or altered on earlier tables, no
-- customer rows are touched, and no Default-Operation fallback is introduced
-- (every profile row is 1:1 with an operation).
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';'). Idempotent
-- with IF NOT EXISTS / DO NOTHING guards. NOT applied to live Neon yet — the
-- lead applies it for separate approval.
--
-- Setup completeness for the dashboard progress card is derived from a simple
-- checklist, NOT from whether the optional profile fields are filled:
--   1 ranch/operation name (operations.name — always present, from register)
--   2 primary operation type (operation_profile.operation_type)
--   3 ranch/farm acres (operation_profile.acres)
--   4 primary species/focus (operation_profile.primary_species)
--   5 templates downloaded (operation_profile.templates_downloaded)
-- The profile row is inserted (with setup_completed=false) by the onboarding
-- server fn on first save; rows are read/written only via the onboarding
-- server functions, scoped by the authenticated operation_id (owner role).

-- Optional, editable operation profile (one per operation). All columns
-- nullable — setup can be saved partially and finished later.
CREATE TABLE IF NOT EXISTS operation_profile (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id         integer NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
  location             text,
  operation_type       text CHECK (
                         operation_type IS NULL OR
                         operation_type IN ('cattle', 'mixed_livestock', 'horses', 'crops_farm', 'mixed_ranch_farm')
                       ),
  acres                numeric CHECK (acres IS NULL OR acres > 0),
  primary_species      text,
  templates_downloaded boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_profile_operation_id_idx ON operation_profile (operation_id);

-- Onboarding visibility columns on operations (nullable, additive):
--   onboarding_started_at  — set when the owner first saves setup (drives the
--                            dashboard setup-progress card for users who skip)
--   onboarding_completed_at — set when the owner finishes setup (card hides)
ALTER TABLE operations ADD COLUMN IF NOT EXISTS onboarding_started_at timestamptz;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;