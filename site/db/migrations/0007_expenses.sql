-- Expense ledger backing the Costs section of the Daily Operations dashboard
-- and the multi-dimensional cost-allocation reports. Every row carries the
-- allocation dimensions from the cost spec: date & vendor, expense category,
-- the livestock herd/lot (whose species provides the species dimension), the
-- pasture, the equipment asset, and the job/activity. Ranch/entity is implicit
-- at the operation level for now. Costs are stored in minor units (cents).
CREATE TABLE IF NOT EXISTS expenses (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_date  date NOT NULL,
  category      text NOT NULL CHECK (category IN ('feed', 'vet_health', 'maintenance', 'insurance', 'fuel', 'other')),
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  vendor        text,
  herd_group_id integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  pasture_id    integer REFERENCES pastures(id) ON DELETE SET NULL,
  equipment_id  integer REFERENCES equipment(id) ON DELETE SET NULL,
  job           text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category);
