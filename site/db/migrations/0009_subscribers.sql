-- 0009_subscribers.sql — email-signup capture (Ranch Manager Pro)
-- Additive only: creates a single table for landing-page email signups, no
-- impact on existing tables. Re-running is safe (CREATE TABLE IF NOT EXISTS +
-- index IF NOT EXISTS). The signup form IS the opt-in: submitting it records
-- explicit consent via opted_in = true; nothing is pre-checked and nobody is
-- added except through the form. UNIQUE(email) plus ON CONFLICT DO NOTHING on
-- insert makes re-submits idempotent (no duplicates, no errors).
CREATE TABLE IF NOT EXISTS subscribers (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  name       text,
  source     text NOT NULL DEFAULT 'landing-page',
  opted_in   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscribers_created_at_idx ON subscribers (created_at);
