-- Employees & payroll-lite (Phase 1 of the owners' requested feature; Phase 2,
-- the tax/ag-exemption registry, is a separate later task).
--
-- Tracks workers, their pay basis, hours, crew/assignment, hire date, and
-- contact. Wage/rate and hours are stored as PLAIN NUMERIC values (not integer
-- minor units) so a future per-operation currency/unit locale toggle can
-- localize them cleanly — no currency symbol is baked into the data layer and
-- only the display layer formats them. Labor cost is computed at read time:
--   hourly   = hours * wage_rate
--   salary   = salary_amount   (monthly gross)
--   contract = contract_amount (monthly contract payment)
-- Columns parallel the expenses ledger so a worker can be allocated to a herd
-- (herd_group_id) and a job/activity (job) the same way any cost is.
CREATE TABLE IF NOT EXISTS employees (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  role            text,
  pay_type        text NOT NULL CHECK (pay_type IN ('hourly', 'salary', 'contract')),
  wage_rate       numeric,          -- USD per hour (hourly)
  hours           numeric,          -- hours logged this period (hourly)
  salary_amount   numeric,          -- monthly gross (salary)
  contract_amount numeric,          -- monthly contract payment (contract)
  crew            text,             -- crew or assignment
  hire_date       date,
  contact         text,             -- phone / email
  job             text,             -- job/activity, allocable like expenses
  herd_group_id   integer REFERENCES herd_groups(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_pay_type_idx ON employees (pay_type);
CREATE INDEX IF NOT EXISTS employees_job_idx ON employees (job);
CREATE INDEX IF NOT EXISTS employees_herd_group_idx ON employees (herd_group_id);
