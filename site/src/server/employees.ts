// ============================================================================
// Ranch Manager Pro — Employees & payroll-lite server functions (the only place
// that talks to the database for this module). Import only from route
// files/components; the handlers run on the server and return JSON-safe data.
//
// Labor cost is computed per worker at read time from the plain numeric fields:
//   hourly   = hours * wage_rate
//   salary   = salary_amount   (monthly gross)
//   contract = contract_amount (monthly contract payment)
// Rollups (total, per hour, per head, by crew/job/pay+type) are derived from
// those per-worker costs. cost/head uses the live active head count from the
// animals table so it feeds the app's cost-per-head picture consistently.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import {
  PAY_TYPES,
  type DimensionLabor,
  type EmployeeData,
  type EmployeeInput,
  type EmployeeRow,
  type HerdGroupRef,
  type PayType,
} from "~/types/employees";

// ---------------------------------------------------------------------------
// Small validators (same conventions as the feed module)
// ---------------------------------------------------------------------------
const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const numOrNull = (v: unknown, field: string, min = 0): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`${field} must be a number ≥ ${min}.`);
  return n;
};
const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  return s;
};

/** Per-worker labor cost (dollars) from the stored plain numeric fields. */
function laborCost(r: {
  pay_type: PayType;
  wage_rate: number | null;
  hours: number | null;
  salary_amount: number | null;
  contract_amount: number | null;
}): number {
  if (r.pay_type === "hourly") return (r.hours ?? 0) * (r.wage_rate ?? 0);
  if (r.pay_type === "salary") return r.salary_amount ?? 0;
  return r.contract_amount ?? 0;
}

function parseEmployeeInput(raw: unknown): EmployeeInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  const pay_type = oneOf(d.pay_type, PAY_TYPES);
  if (!name) throw new Error("Name is required.");
  if (!pay_type) throw new Error("Pick a pay type (hourly, salary, or contract).");
  const wage_rate = numOrNull(d.wage_rate, "Hourly wage", 0);
  const hours = numOrNull(d.hours, "Hours", 0);
  const salary_amount = numOrNull(d.salary_amount, "Monthly salary", 0);
  const contract_amount = numOrNull(d.contract_amount, "Monthly contract amount", 0);
  if (pay_type === "hourly" && (!wage_rate || wage_rate <= 0)) {
    throw new Error("An hourly worker needs a wage rate.");
  }
  if (pay_type === "salary" && (!salary_amount || salary_amount <= 0)) {
    throw new Error("A salaried worker needs a monthly salary amount.");
  }
  if (pay_type === "contract" && (!contract_amount || contract_amount <= 0)) {
    throw new Error("A contract worker needs a monthly contract amount.");
  }
  return {
    id: optionalInt(d.id) ?? undefined,
    name,
    role: str(d.role),
    pay_type,
    wage_rate,
    hours,
    salary_amount,
    contract_amount,
    crew: str(d.crew),
    hire_date: isoDate(d.hire_date),
    contact: str(d.contact),
    job: str(d.job),
    herd_group_id: optionalInt(d.herd_group_id),
    notes: str(d.notes),
  };
}

function groupLabor(rows: EmployeeRow[], key: (r: EmployeeRow) => string | null): DimensionLabor[] {
  const map = new Map<string, { labor_cost: number; entries: number }>();
  for (const r of rows) {
    const k = key(r) ?? "Unallocated";
    const cur = map.get(k) ?? { labor_cost: 0, entries: 0 };
    cur.labor_cost += r.labor_cost;
    cur.entries += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, labor_cost: round2(v.labor_cost), entries: v.entries }))
    .sort((a, b) => b.labor_cost - a.labor_cost);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------
export const getEmployeesData = createServerFn().handler(async (): Promise<EmployeeData> => {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      employees: [],
      groups: [],
      totalLabor: 0,
      totalHours: 0,
      activeHead: 0,
      laborPerHour: null,
      laborPerHead: null,
      byPayType: [],
      byCrew: [],
      byJob: [],
    };
  }
  try {
    const db = sql();
    const [emplRows, groupRows, headRow] = await Promise.all([
      db`
        SELECT e.id, e.name, e.role, e.pay_type,
               e.wage_rate::float8 AS wage_rate, e.hours::float8 AS hours,
               e.salary_amount::float8 AS salary_amount, e.contract_amount::float8 AS contract_amount,
               e.crew, to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date, e.contact,
               e.job, e.herd_group_id, hg.name AS herd_group_name, e.notes,
               e.created_at::text AS created_at, e.updated_at::text AS updated_at
        FROM employees e
        LEFT JOIN herd_groups hg ON hg.id = e.herd_group_id
        ORDER BY e.pay_type, e.name, e.id`,
      db<HerdGroupRef[]>`SELECT id, name FROM herd_groups ORDER BY name`,
      db<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM animals WHERE status = 'active'`,
    ]);

    const employees: EmployeeRow[] = emplRows.map((r) => ({
      ...(r as unknown as Omit<EmployeeRow, "labor_cost">),
      labor_cost: round2(laborCost(r as unknown as EmployeeRow)),
    }));

    const totalLabor = round2(employees.reduce((s, r) => s + r.labor_cost, 0));
    const totalHours = round2(employees.reduce((s, r) => s + (r.hours ?? 0), 0));
    const activeHead = headRow[0]?.n ?? 0;

    return {
      configured: true,
      employees,
      groups: groupRows,
      totalLabor,
      totalHours,
      activeHead,
      laborPerHour: totalHours > 0 ? round2(totalLabor / totalHours) : null,
      laborPerHead: activeHead > 0 ? round2(totalLabor / activeHead) : null,
      byPayType: groupLabor(employees, (r) => r.pay_type),
      byCrew: groupLabor(employees, (r) => r.crew),
      byJob: groupLabor(employees, (r) => r.job),
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      employees: [],
      groups: [],
      totalLabor: 0,
      totalHours: 0,
      activeHead: 0,
      laborPerHour: null,
      laborPerHead: null,
      byPayType: [],
      byCrew: [],
      byJob: [],
    };
  }
});

// ---------------------------------------------------------------------------
// Write: save employee (insert or update)
// ---------------------------------------------------------------------------
export const saveEmployee = createServerFn({ method: "POST" })
  .validator(parseEmployeeInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const e = data;
      if (e.id) {
        const updated = await db`
          UPDATE employees SET name=${e.name}, role=${e.role}, pay_type=${e.pay_type},
            wage_rate=${e.wage_rate}, hours=${e.hours}, salary_amount=${e.salary_amount},
            contract_amount=${e.contract_amount}, crew=${e.crew}, hire_date=${e.hire_date},
            contact=${e.contact}, job=${e.job}, herd_group_id=${e.herd_group_id},
            notes=${e.notes}, updated_at=now()
          WHERE id=${e.id} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Employee #${e.id} no longer exists.` };
        return { ok: true, id: e.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO employees (name, role, pay_type, wage_rate, hours, salary_amount,
                               contract_amount, crew, hire_date, contact, job, herd_group_id, notes)
        VALUES (${e.name}, ${e.role}, ${e.pay_type}, ${e.wage_rate}, ${e.hours}, ${e.salary_amount},
                ${e.contract_amount}, ${e.crew}, ${e.hire_date}, ${e.contact}, ${e.job},
                ${e.herd_group_id}, ${e.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: delete employee
// ---------------------------------------------------------------------------
const parseDeleteInput = (raw: unknown): { id: number } => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id) throw new Error("Employee id is required.");
  return { id };
};

export const deleteEmployee = createServerFn({ method: "POST" })
  .validator(parseDeleteInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const del = await db`DELETE FROM employees WHERE id=${data.id} RETURNING id`;
      if (del.length === 0) return { ok: false, error: `Employee #${data.id} no longer exists.` };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
