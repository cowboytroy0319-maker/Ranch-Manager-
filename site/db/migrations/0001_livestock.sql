-- 0001_livestock.sql — Livestock Inventory & Health (Ranch Manager Pro)
-- One statement per semicolon-terminated block; no functions/triggers.
-- The migrate runner (db/migrate.ts) splits on semicolons, so keep it that way.

CREATE TABLE IF NOT EXISTS herd_groups (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     text NOT NULL,
  species  text NOT NULL CHECK (species IN ('cattle', 'horse', 'goat', 'sheep')),
  notes    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS animals (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  species       text NOT NULL CHECK (species IN ('cattle', 'horse', 'goat', 'sheep')),
  name          text NOT NULL,
  tag_number    text,
  sex           text CHECK (sex IN ('female', 'male', 'castrated')),
  breed         text,
  birth_date    date,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'sold', 'deceased', 'pending')),
  herd_group_id integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  pasture       text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_events (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  animal_id       integer NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  event_date      date NOT NULL,
  type            text NOT NULL
                  CHECK (type IN ('vaccination', 'treatment', 'inspection', 'injury', 'other')),
  description     text,
  product         text,
  dosage          text,
  vet             text,
  withdrawal_days integer,
  next_due        date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS animals_species_idx ON animals (species);
CREATE INDEX IF NOT EXISTS animals_status_idx ON animals (status);
CREATE INDEX IF NOT EXISTS animals_herd_group_idx ON animals (herd_group_id);
CREATE INDEX IF NOT EXISTS health_events_animal_idx ON health_events (animal_id);
CREATE INDEX IF NOT EXISTS health_events_next_due_idx ON health_events (next_due);
