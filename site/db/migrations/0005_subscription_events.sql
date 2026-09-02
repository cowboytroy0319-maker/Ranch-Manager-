-- 0005_subscription_events.sql — Stripe subscription event log (Ranch Manager Pro)
-- Additive only: creates a new table + index; does not drop or alter anything
-- from earlier migrations. One statement per semicolon-terminated block, no
-- semicolons inside comments (the migrate runner strips comment lines, then
-- splits on ';').
CREATE TABLE IF NOT EXISTS subscription_events (
  id              bigserial PRIMARY KEY,
  event_id        text UNIQUE NOT NULL,
  type            text NOT NULL,
  customer_id     text,
  subscription_id text,
  price_id        text,
  tier            text,
  amount_cents    bigint,
  currency        text,
  status          text,
  email           text,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_events_type_idx ON subscription_events (type);
CREATE INDEX IF NOT EXISTS subscription_events_customer_idx ON subscription_events (customer_id);
CREATE INDEX IF NOT EXISTS subscription_events_created_at_idx ON subscription_events (created_at);
