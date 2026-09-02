-- 0002_feed.sql — Hay & Feed Inventory (Ranch Manager Pro, phase 2)
-- Additive only: creates new tables + indexes; does not drop or alter anything
-- from 0001. One statement per semicolon-terminated block, no semicolons
-- inside comments (the migrate runner strips comment lines, then splits on ';').

CREATE TABLE IF NOT EXISTS hay_inventory (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_type           text NOT NULL CHECK (feed_type IN ('grass', 'alfalfa', 'mixed', 'other')),
  cutting             text,
  field_or_source     text,
  storage_location    text,
  quantity            numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit                text NOT NULL CHECK (unit IN ('bales', 'tons')),
  bale_weight_lbs     numeric CHECK (bale_weight_lbs IS NULL OR bale_weight_lbs > 0),
  date_acquired       date,
  low_stock_threshold numeric NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_inventory (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                text NOT NULL,
  category            text NOT NULL CHECK (category IN ('grain', 'supplement', 'mineral', 'hay-substitute', 'other')),
  quantity            numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit                text NOT NULL CHECK (unit IN ('lbs', 'bags', 'tons')),
  supplier            text,
  unit_cost_cents     integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  low_stock_threshold numeric NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_log (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  log_date       date NOT NULL,
  item_kind      text NOT NULL CHECK (item_kind IN ('hay', 'feed')),
  hay_item_id    integer REFERENCES hay_inventory(id) ON DELETE SET NULL,
  feed_item_id   integer REFERENCES feed_inventory(id) ON DELETE SET NULL,
  quantity       numeric NOT NULL CHECK (quantity > 0),
  unit           text NOT NULL,
  herd_group_id  integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  pasture        text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_log_one_item CHECK (
    (hay_item_id IS NOT NULL AND feed_item_id IS NULL)
    OR (hay_item_id IS NULL AND feed_item_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS hay_inventory_type_idx ON hay_inventory (feed_type);
CREATE INDEX IF NOT EXISTS feed_inventory_category_idx ON feed_inventory (category);
CREATE INDEX IF NOT EXISTS usage_log_date_idx ON usage_log (log_date);
CREATE INDEX IF NOT EXISTS usage_log_hay_item_idx ON usage_log (hay_item_id);
CREATE INDEX IF NOT EXISTS usage_log_feed_item_idx ON usage_log (feed_item_id);
CREATE INDEX IF NOT EXISTS usage_log_herd_group_idx ON usage_log (herd_group_id);
