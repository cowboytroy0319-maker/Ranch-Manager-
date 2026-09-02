-- 0003_pasture.sql — Pasture & Grazing (Ranch Manager Pro, phase 3)
-- Additive only: creates new tables + indexes; does not drop or alter anything
-- from 0001/0002. One statement per semicolon-terminated block, no semicolons
-- inside comments (the migrate runner strips comment lines, then splits on ';').

-- Paddocks / fields. `status` is the pasture's current management state; the
-- richer grazing/rest picture lives in grazing_log and pasture_assignments.
CREATE TABLE IF NOT EXISTS pastures (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  size_acres  numeric NOT NULL CHECK (size_acres > 0),
  location    text,
  status      text NOT NULL DEFAULT 'resting'
              CHECK (status IN ('grazing', 'resting', 'idle', 'maintenance')),
  soil_type   text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Which herd (or species) is/was assigned to a pasture, and for how many
-- target grazing days. `ended_at IS NULL` marks the CURRENT assignment.
CREATE TABLE IF NOT EXISTS pasture_assignments (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pasture_id          integer NOT NULL REFERENCES pastures(id) ON DELETE CASCADE,
  herd_group_id       integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  assigned_at         date NOT NULL,
  target_grazing_days integer CHECK (target_grazing_days IS NULL OR target_grazing_days > 0),
  ended_at            date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Daily grazing/rest record per pasture — powers rotational-grazing insight
-- (days grazed vs days rested).
CREATE TABLE IF NOT EXISTS grazing_log (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pasture_id  integer NOT NULL REFERENCES pastures(id) ON DELETE CASCADE,
  log_date    date NOT NULL,
  status      text NOT NULL CHECK (status IN ('grazing', 'rest')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Observations / notes tied to a pasture, with an optional action-due date
-- so the daily view can surface "actions due".
CREATE TABLE IF NOT EXISTS pasture_observations (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pasture_id   integer NOT NULL REFERENCES pastures(id) ON DELETE CASCADE,
  observed_on  date NOT NULL,
  category     text NOT NULL
               CHECK (category IN ('forage', 'water', 'fence', 'soil', 'pest', 'other')),
  note         text,
  action_due   date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pastures_status_idx ON pastures (status);
CREATE INDEX IF NOT EXISTS pasture_assignments_pasture_idx ON pasture_assignments (pasture_id);
CREATE INDEX IF NOT EXISTS pasture_assignments_active_idx ON pasture_assignments (pasture_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS pasture_assignments_herd_idx ON pasture_assignments (herd_group_id);
CREATE INDEX IF NOT EXISTS grazing_log_pasture_date_idx ON grazing_log (pasture_id, log_date);
CREATE INDEX IF NOT EXISTS pasture_observations_pasture_idx ON pasture_observations (pasture_id);
CREATE INDEX IF NOT EXISTS pasture_observations_action_idx ON pasture_observations (action_due);
