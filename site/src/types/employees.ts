// ============================================================================
// Ranch Manager Pro — Employees & payroll-lite module types (shared client +
// server). All values are JSON-safe (dates are strings, money/hours are plain
// numbers). Wage/rate and hours are PLAIN NUMERIC values so a future
// per-operation currency/unit locale toggle can localize them cleanly — no
// currency symbol lives in the data layer; only the display layer formats it.
// ============================================================================
export const PAY_TYPES = ["hourly", "salary", "contract"] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const PAY_TYPE_LABEL: Record<PayType, string> = {
  hourly: "Hourly",
  salary: "Salary",
  contract: "Contract",
};

/** A single worker with the joined dimension names resolved by the server so
 * the client never has to look them up. `labor_cost` is computed per pay_type:
 * hours×wage_rate ; salary_amount ; contract_amount. Amounts are dollars. */
export type EmployeeRow = {
  id: number;
  name: string;
  role: string | null;
  pay_type: PayType;
  wage_rate: number | null;
  hours: number | null;
  salary_amount: number | null;
  contract_amount: number | null;
  crew: string | null;
  hire_date: string | null; // YYYY-MM-DD
  contact: string | null;
  job: string | null;
  herd_group_id: number | null;
  herd_group_name: string | null;
  notes: string | null;
  labor_cost: number; // dollars
  created_at: string;
  updated_at: string;
};

export type HerdGroupRef = { id: number; name: string };

/** Labor rollup tied to the app's cost-per-head differentiator. */
export type DimensionLabor = {
  name: string; // display label for the allocation bucket
  labor_cost: number; // dollars
  entries: number;
};

export type EmployeeData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  employees: EmployeeRow[];
  groups: HerdGroupRef[];
  totalLabor: number; // dollars across all workers
  totalHours: number; // hours logged across all workers
  activeHead: number; // live head count (active animals) — cost/head denominator
  laborPerHour: number | null; // totalLabor / totalHours
  laborPerHead: number | null; // totalLabor / activeHead
  byPayType: DimensionLabor[];
  byCrew: DimensionLabor[];
  byJob: DimensionLabor[];
};

/** Input for create/update — mirrors EmployeeRow minus the computed fields. */
export type EmployeeInput = {
  id?: number;
  name: string;
  role: string | null;
  pay_type: PayType;
  wage_rate: number | null;
  hours: number | null;
  salary_amount: number | null;
  contract_amount: number | null;
  crew: string | null;
  hire_date: string | null;
  contact: string | null;
  job: string | null;
  herd_group_id: number | null;
  notes: string | null;
};
