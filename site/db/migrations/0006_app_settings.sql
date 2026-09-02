-- 0006_app_settings.sql — server-side settings/config store (Ranch Manager Pro)
-- Additive only: creates a small key/value table, no impact on existing tables.
-- It holds a server-side secret (e.g. the Stripe webhook signing secret) so the
-- live host can resolve it from the database instead of requiring a value on
-- the platform Secrets page. Re-running is safe (CREATE TABLE IF NOT EXISTS +
-- ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Seed the Stripe webhook signing secret for endpoint we_1UAJjZRQ3GjX4x9CNry2eobs.
-- Idempotent: if the row already exists (e.g. operator corrected a future
-- rotation on the live host), this leaves it untouched.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('stripe_webhook_secret', 'whsec_REPLACE_ME_EXAMPLE_ONLY', now())
ON CONFLICT (key) DO NOTHING;
