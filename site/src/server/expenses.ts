// ============================================================================
// Ranch Manager Pro — Expenses server function (the only place that talks to
// the database for expense data). Reads the current-month cost ledger the
// CostsSnapshot + /expenses route render. Fuel is intentionally NOT read here —
// it stays sourced from `fuel_log` via getCostData so nothing is double-counted.
// Maintenance spend is read from expenses.category='maintenance' (the ledger),
// NOT from maintenance_records, so the dashboard shows one maintenance figure.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import type { DimensionTotal, ExpenseData, ExpenseRow } from "~/types/expenses";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "~/types/expenses";

// Current-month scope: every aggregate and row below filters to the month the
// DB clock says it currently is, so the dashboard always shows this month.
// (operation_id is bound per query below via the ${auth.operationId} params.)
const THIS_MONTH = "e.expense_date >= date_trunc('month', now())::date";

export const getExpensesData = createServerFn().handler(async (): Promise<ExpenseData> => {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      month: "",
      totalCents: 0,
      totalEntries: 0,
      byCategory: [],
      byHerd: [],
      byPasture: [],
      byEquipment: [],
      byJob: [],
      rows: [],
    };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const operationId = auth.operationId;
    const monthRow = await db`select to_char(date_trunc('month', now()), 'YYYY-MM') as m`;
    const month = monthRow[0]?.m ?? new Date().toISOString().slice(0, 7);
    const [rows, cat, herd, pasture, equipment, job, grand] = await Promise.all([
      db<ExpenseRow[]>`
        SELECT e.id, e.expense_date::text AS expense_date, e.category, e.amount_cents,
               e.vendor, e.herd_group_id, hg.name AS herd_group_name, hg.species,
               e.pasture_id, p.name AS pasture_name, e.equipment_id, eq.name AS equipment_name,
               e.job, e.notes
        FROM expenses e
        LEFT JOIN herd_groups hg ON hg.id = e.herd_group_id
        LEFT JOIN pastures p ON p.id = e.pasture_id
        LEFT JOIN equipment eq ON eq.id = e.equipment_id
        WHERE e.operation_id = ${operationId} AND ${db.unsafe(THIS_MONTH)}
        ORDER BY e.expense_date, e.id`,
      db<{ category: ExpenseRow["category"]; amount_cents: number; entries: number }[]>`
        SELECT category, SUM(amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
        FROM expenses
        WHERE operation_id = ${operationId}
          AND expense_date >= date_trunc('month', now())::date
        GROUP BY category ORDER BY amount_cents DESC`,
      db<DimensionTotal[]>`
        SELECT coalesce(hg.name, 'Unallocated') AS name,
               coalesce(hg.species, 'none') AS species,
               SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
        FROM expenses e LEFT JOIN herd_groups hg ON hg.id = e.herd_group_id
        WHERE e.operation_id = ${operationId} AND ${db.unsafe(THIS_MONTH)}
        GROUP BY 1, 2 ORDER BY amount_cents DESC`,
      db<DimensionTotal[]>`
        SELECT coalesce(p.name, 'Unallocated') AS name,
               SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
        FROM expenses e LEFT JOIN pastures p ON p.id = e.pasture_id
        WHERE e.operation_id = ${operationId} AND ${db.unsafe(THIS_MONTH)}
        GROUP BY 1 ORDER BY amount_cents DESC`,
      db<DimensionTotal[]>`
        SELECT coalesce(eq.name, 'Unallocated') AS name,
               SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
        FROM expenses e LEFT JOIN equipment eq ON eq.id = e.equipment_id
        WHERE e.operation_id = ${operationId} AND ${db.unsafe(THIS_MONTH)}
        GROUP BY 1 ORDER BY amount_cents DESC`,
      db<DimensionTotal[]>`
        SELECT coalesce(e.job, 'Unallocated') AS name,
               SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
        FROM expenses e
        WHERE e.operation_id = ${operationId} AND ${db.unsafe(THIS_MONTH)}
        GROUP BY 1 ORDER BY amount_cents DESC`,
      db<{ total_cents: number; total_entries: number }[]>`
        SELECT coalesce(SUM(amount_cents), 0)::int AS total_cents, COUNT(*)::int AS total_entries
        FROM expenses
        WHERE operation_id = ${operationId}
          AND expense_date >= date_trunc('month', now())::date`,
    ]);
    const g = grand[0];
    return {
      configured: true,
      month,
      totalCents: g?.total_cents ?? 0,
      totalEntries: g?.total_entries ?? 0,
      byCategory: cat as unknown as ExpenseData["byCategory"],
      byHerd: herd,
      byPasture: pasture,
      byEquipment: equipment,
      byJob: job,
      rows,
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      month: new Date().toISOString().slice(0, 7),
      totalCents: 0,
      totalEntries: 0,
      byCategory: [],
      byHerd: [],
      byPasture: [],
      byEquipment: [],
      byJob: [],
      rows: [],
    };
  }
});
// ---------------------------------------------------------------------------
// Validation + Write: save expense (insert or update, operation-scoped)
// ---------------------------------------------------------------------------
const str0 = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};
const oneOf0 = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const optionalInt0 = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
export type ExpenseInput = {
  id?: number;
  expense_date: string;
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
  herd_group_id: number | null;
  pasture_id: number | null;
  equipment_id: number | null;
  job: string | null;
  notes: string | null;
};
export function parseExpenseInput(raw: unknown): ExpenseInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const expenseDate = str0(d.expense_date);
  if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || Number.isNaN(Date.parse(expenseDate))) {
    throw new Error("Expense date must be a valid date (YYYY-MM-DD).");
  }
  const amount = Number(d.amount_cents);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Expense amount can't be negative.");
  const cents = Math.round(amount);
  return {
    id: optionalInt0(d.id) ?? undefined,
    expense_date: expenseDate,
    category: oneOf0(d.category, EXPENSE_CATEGORIES) ?? "other",
    amount_cents: cents,
    vendor: str0(d.vendor),
    herd_group_id: optionalInt0(d.herd_group_id),
    pasture_id: optionalInt0(d.pasture_id),
    equipment_id: optionalInt0(d.equipment_id),
    job: str0(d.job),
    notes: str0(d.notes),
  };
}
export const saveExpense = createServerFn({ method: "POST" })
  .validator(parseExpenseInput)
  .handler(async ({ data: e }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      if (e.id) {
        const updated = await db`
          UPDATE expenses SET expense_date=${e.expense_date}, category=${e.category},
            amount_cents=${e.amount_cents}, vendor=${e.vendor}, herd_group_id=${e.herd_group_id},
            pasture_id=${e.pasture_id}, equipment_id=${e.equipment_id}, job=${e.job}, notes=${e.notes}
          WHERE id=${e.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Expense #${e.id} no longer exists in this ranch.` };
        return { ok: true, id: e.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor,
                              herd_group_id, pasture_id, equipment_id, job, notes)
        VALUES (${auth.operationId}, ${e.expense_date}, ${e.category}, ${e.amount_cents}, ${e.vendor},
                ${e.herd_group_id}, ${e.pasture_id}, ${e.equipment_id}, ${e.job}, ${e.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
