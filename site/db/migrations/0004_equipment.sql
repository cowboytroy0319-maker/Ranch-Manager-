-- 0004_equipment.sql — Equipment, Fuel, & Maintenance (Ranch Manager Pro, phase 4)
-- Additive only: creates new tables + indexes; does not drop or alter anything
-- from 0001/0002/0003. One statement per semicolon-terminated block, no semicolons
-- inside comments (the migrate runner strips comment lines, then splits on ';').

-- Fleet / assets register. `hours` and `miles` are the two meter types a piece of
-- equipment tracks — most machines use one or the other, some (a service truck)
-- use both. `status` is the current operational state; the richer "maintenance
-- due by hours/miles/date" picture is computed from maintenance_records so an
-- operator can spot what needs attention on the daily view.
CREATE TABLE IF NOT EXISTS equipment (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'other'
                CHECK (category IN ('truck', 'tractor', 'trailer', 'implement', 'atv', 'stationary', 'other')),
  make          text,
  model         text,
  year          integer CHECK (year IS NULL OR (year >= 1900 AND year <= 2100)),
  hours         numeric CHECK (hours IS NULL OR hours >= 0),
  miles         numeric CHECK (miles IS NULL OR miles >= 0),
  condition     text CHECK (condition IN ('excellent', 'good', 'fair', 'poor')),
  status        text NOT NULL DEFAULT 'in-service'
                CHECK (status IN ('in-service', 'maintenance-due', 'out-of-service')),
  location      text,
  license_plate text,
  fuel_type     text CHECK (fuel_type IN ('diesel', 'gasoline', 'gas', 'electric', 'other')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Service history + open work orders. `status='done'` marks a completed service;
-- `status='open'` marks an outstanding repair (parts on order, a shop job waiting).
-- `next_due_hours` / `next_due_miles` / `next_due_date` let the daily view flag
-- "due now / overdue" by whichever meter the operator tracks.
CREATE TABLE IF NOT EXISTS maintenance_records (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id   integer NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  service_date   date NOT NULL,
  service_type   text NOT NULL
                 CHECK (service_type IN ('oil-change', 'scheduled', 'repair', 'tire', 'inspection', 'other')),
  description    text,
  cost_cents     integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  meter_hours    numeric CHECK (meter_hours IS NULL OR meter_hours >= 0),
  meter_miles    numeric CHECK (meter_miles IS NULL OR meter_miles >= 0),
  status         text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'open')),
  next_due_date  date,
  next_due_hours numeric CHECK (next_due_hours IS NULL OR next_due_hours >= 0),
  next_due_miles numeric CHECK (next_due_miles IS NULL OR next_due_miles >= 0),
  vendor         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Refueling log. `equipment_id` is nullable so a bulk tank/barrel top-up that
-- isn't tied to one machine can still be recorded. Fuel type and cost in cents
-- support the per-asset / per-month fuel cost the reports want.
CREATE TABLE IF NOT EXISTS fuel_log (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id  integer REFERENCES equipment(id) ON DELETE SET NULL,
  fuel_date     date NOT NULL,
  fuel_type     text NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('diesel', 'gasoline', 'gas', 'other')),
  gallons       numeric NOT NULL CHECK (gallons > 0),
  cost_cents    integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  price_per_gal_cents integer CHECK (price_per_gal_cents IS NULL OR price_per_gal_cents >= 0),
  meter_hours   numeric CHECK (meter_hours IS NULL OR meter_hours >= 0),
  meter_miles   numeric CHECK (meter_miles IS NULL OR meter_miles >= 0),
  location      text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_status_idx ON equipment (status);
CREATE INDEX IF NOT EXISTS equipment_category_idx ON equipment (category);
CREATE INDEX IF NOT EXISTS maintenance_equipment_idx ON maintenance_records (equipment_id);
CREATE INDEX IF NOT EXISTS maintenance_next_due_date_idx ON maintenance_records (next_due_date);
CREATE INDEX IF NOT EXISTS maintenance_status_idx ON maintenance_records (status);
CREATE INDEX IF NOT EXISTS fuel_log_date_idx ON fuel_log (fuel_date);
CREATE INDEX IF NOT EXISTS fuel_log_equipment_idx ON fuel_log (equipment_id);
