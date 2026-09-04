-- 0015_tasks_projects.sql — Ranch Tasks & Projects (Ranch Manager Pro, phase 15)
-- Additive only: creates the projects + tasks tables and their indexes; does not
-- drop or alter anything from earlier migrations. Every row is scoped to an
-- operation (ranch) via operation_id so accounts never see each other's work.
-- One statement per semicolon-terminated block, no semicolons inside comments
-- (the migrate runner strips comment lines, then splits on ';').

-- Projects group related work (e.g. "2026 fence build").
CREATE TABLE IF NOT EXISTS projects (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id  integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_operation_id_idx ON projects (operation_id);

-- Tasks: the daily to-do/kanban record. Status/priority/category are CHECK-
-- constrained; due_date is optional; project_id + the optional link columns
-- (pasture / equipment / animal) keep a task attachable to the module records
-- that already exist (pastures.id, equipment.id, animals.id).
CREATE TABLE IF NOT EXISTS tasks (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id  integer NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'to_do'
                CHECK (status IN ('to_do', 'in_progress', 'completed', 'canceled')),
  priority      text NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date      date,
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('livestock', 'feed/hay', 'pasture', 'fencing/water',
                                    'equipment', 'crops/farm', 'paperwork', 'general')),
  project_id    integer REFERENCES projects(id) ON DELETE SET NULL,
  pasture_id    integer REFERENCES pastures(id) ON DELETE SET NULL,
  equipment_id  integer REFERENCES equipment(id) ON DELETE SET NULL,
  animal_id     integer REFERENCES animals(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_operation_id_idx ON tasks (operation_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks (priority);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks (due_date);
CREATE INDEX IF NOT EXISTS tasks_category_idx ON tasks (category);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks (project_id);