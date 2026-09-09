// ============================================================================
// Ranch Manager Pro — Expenses server function (the only place that talks to
// the database for expense data). Reads the cost ledger the CostsSnapshot +
// /expenses route render. Fuel is intentionally NOT read here — it stays
// sourced from `fuel_log` via getCostData so nothing is double-counted.
// Maintenance spend is read from expenses.category='repairs_maintenance' (the
// ledger), NOT from maintenance_records, so the dashboard shows one figure.
//
// Linked expenses (source_type = 'restock' | 'pasture_activity') are created
// ONLY by the feed/pasture server fns — the expenses module never fabricates
// or edits them (deleteExpense rejects linked rows; edit keeps source columns
// untouched). The unique index expenses_source_once_uniq backs exactly-once.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import type { DimensionTotal, ExpenseData, ExpenseFilter, ExpenseRow } from "~/types/expenses";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "~/types/expenses";

// Default scope: the month the DB clock says it currently is, so the dashboard
// always shows this month. Optional {from, to} bounds (YYYY-MM-DD) + category
// narrow the range when the client passes them. (operation_id is bound per
// query below via the ${auth.operationId} params.)

/** Validate + normalize the optional ledger filters; throws safe messages. */
export function parseExpenseFilters(raw: unknown): ExpenseFilter {
  const d = (raw ?? {}) as Record<string, unknown>;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const clean = (v: unknown): string | null =>
    typeof v === "string" && v.trim() && dateRe.test(v.trim()) ? v.trim() : null;
  const from = clean(d.from);
  const to = clean(d.to);
  if (from && to && to < from) {
    throw new Error("The start date can't be after the end date.");
  }
  // Unknown category strings are rejected (never silently widened); an empty
  // string means "all categories".
  const category =
    typeof d.category === "string" &&
    (EXPENSE_CATEGORIES as readonly string[]).includes(d.category)
      ? (d.category as ExpenseCategory)
      : null;
  return { from, to, category };
}

export const getExpensesData = createServerFn()
  .validator(parseExpenseFilters)
  .handler(async ({ data: filter }): Promise<ExpenseData> => {
    if (!isDatabaseConfigured()) {
      return {
        configured: false,
        month: "",
        from: null,
        to: null,
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
      const [monthRow] = await db<[{ m: string }]>`select to_char(date_trunc('month', now()), 'YYYY-MM') as m`;
      const month = monthRow?.m ?? new Date().toISOString().slice(0, 7);

      // Date-range scope: either the caller's {from,to} bounds or the current
      // month. Nested sql fragments keep every user value a bound parameter.
      const hasRange = Boolean(filter.from || filter.to);
      const scopeFrag = () =>
        hasRange
          ? db`
              ${filter.from ? db`AND expense_date >= ${filter.from}` : db``}
              ${filter.to ? db`AND expense_date <= ${filter.to}` : db``}`
          : db`AND expense_date >= date_trunc('month', now())::date`;
      const catFrag = () => (filter.category ? db`AND category = ${filter.category}` : db``);
      // Same scoping for the aliased row query.
      const scopeFragE = () =>
        hasRange
          ? db`
              ${filter.from ? db`AND e.expense_date >= ${filter.from}` : db``}
              ${filter.to ? db`AND e.expense_date <= ${filter.to}` : db``}`
          : db`AND e.expense_date >= date_trunc('month', now())::date`;
      const catFragE = () => (filter.category ? db`AND e.category = ${filter.category}` : db``);

      const [rows, cat, herd, pasture, equipment, job, grand] = await Promise.all([
        db<ExpenseRow[]>`
          SELECT e.id, e.expense_date::text AS expense_date, e.category, e.amount_cents,
                 e.vendor, e.paid_by, e.source_type, e.source_id,
                 (e.source_type IS NOT NULL) AS linked,
                 e.herd_group_id, hg.name AS herd_group_name, hg.species,
                 e.pasture_id, p.name AS pasture_name, e.equipment_id, eq.name AS equipment_name,
                 e.job, e.notes
          FROM expenses e
          LEFT JOIN herd_groups hg ON hg.id = e.herd_group_id
          LEFT JOIN pastures p ON p.id = e.pasture_id
          LEFT JOIN equipment eq ON eq.id = e.equipment_id
          WHERE e.operation_id = ${operationId}
          ${scopeFragE()}
          ${catFragE()}
          ORDER BY e.expense_date, e.id`,
        db<{ category: ExpenseRow["category"]; amount_cents: number; entries: number }[]>`
          SELECT category, SUM(amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
          FROM expenses
          WHERE operation_id = ${operationId}
          ${scopeFrag()}
          ${catFrag()}
          GROUP BY category ORDER BY amount_cents DESC`,
        db<DimensionTotal[]>`
          SELECT coalesce(hg.name, 'Unallocated') AS name,
                 coalesce(hg.species, 'none') AS species,
                 SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
          FROM expenses e LEFT JOIN herd_groups hg ON hg.id = e.herd_group_id
          WHERE e.operation_id = ${operationId}
          ${scopeFragE()}
          ${catFragE()}
          GROUP BY 1, 2 ORDER BY amount_cents DESC`,
        db<DimensionTotal[]>`
          SELECT coalesce(p.name, 'Unallocated') AS name,
                 SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
          FROM expenses e LEFT JOIN pastures p ON p.id = e.pasture_id
          WHERE e.operation_id = ${operationId}
          ${scopeFragE()}
          ${catFragE()}
          GROUP BY 1 ORDER BY amount_cents DESC`,
        db<DimensionTotal[]>`
          SELECT coalesce(eq.name, 'Unallocated') AS name,
                 SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
          FROM expenses e LEFT JOIN equipment eq ON eq.id = e.equipment_id
          WHERE e.operation_id = ${operationId}
          ${scopeFragE()}
          ${catFragE()}
          GROUP BY 1 ORDER BY amount_cents DESC`,
        db<DimensionTotal[]>`
          SELECT coalesce(e.job, 'Unallocated') AS name,
                 SUM(e.amount_cents)::int AS amount_cents, COUNT(*)::int AS entries
          FROM expenses e
          WHERE e.operation_id = ${operationId}
          ${scopeFragE()}
          ${catFragE()}
          GROUP BY 1 ORDER BY amount_cents DESC`,
        db<{ total_cents: number; total_entries: number }[]>`
          SELECT coalesce(SUM(amount_cents), 0)::int AS total_cents, COUNT(*)::int AS total_entries
          FROM expenses
          WHERE operation_id = ${operationId}
          ${scopeFrag()}
          ${catFrag()}`,
      ]);
      const g = grand[0];
      return {
        configured: true,
        month,
        from: filter.from ?? null,
        to: filter.to ?? null,
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
      console.error("getExpensesData failed:", err);
      return {
        configured: true,
        error: "We couldn't load your expenses right now. Please refresh and try again.",
        month: new Date().toISOString().slice(0, 7),
        from: filter.from ?? null,
        to: filter.to ?? null,
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
  paid_by: string | null;
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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Expense amount must be greater than zero.");
  }
  // Reject missing/invalid category instead of silently defaulting (a stray
  // value must never reach the DB CHECK constraint).
  const category = oneOf0(d.category, EXPENSE_CATEGORIES);
  if (!category) throw new Error("Pick a category for this expense.");
  const vendor = str0(d.vendor);
  if (!vendor) throw new Error("Payee / description is required.");
  return {
    id: optionalInt0(d.id) ?? undefined,
    expense_date: expenseDate,
    category,
    amount_cents: Math.round(amount),
    vendor,
    paid_by: str0(d.paid_by),
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
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await saveExpenseCore(sql(), auth.operationId, e);
    } catch (err) {
      console.error("saveExpense failed:", err);
      return { ok: false, error: "We couldn't save that expense right now. Please try again." };
    }
  });

/** Injectable expense insert/update — the exact SQL the saveExpense handler
 *  runs, scoped by operation_id. Linked rows (source_type != null) are owned
 *  by their source record and are REJECTED here so the UI can't edit them. */
export async function saveExpenseCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  e: ExpenseInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (e.id) {
    const existing = await db<[{ source_type: string | null }]>`
      SELECT source_type FROM expenses WHERE id=${e.id} AND operation_id=${operationId}`;
    const linked = existing[0]?.source_type ?? null;
    if (linked !== null) {
      return {
        ok: false,
        error: "This expense was created from a hay/feed restock or pasture activity — edit it from that record instead.",
      };
    }
    const updated = await db`
      UPDATE expenses SET expense_date=${e.expense_date}, category=${e.category},
        amount_cents=${e.amount_cents}, vendor=${e.vendor}, paid_by=${e.paid_by},
        herd_group_id=${e.herd_group_id}, pasture_id=${e.pasture_id},
        equipment_id=${e.equipment_id}, job=${e.job}, notes=${e.notes}
      WHERE id=${e.id} AND operation_id=${operationId} RETURNING id`;
    if (updated.length === 0) return { ok: false, error: `Expense #${e.id} no longer exists in this ranch.` };
    return { ok: true, id: e.id };
  }
  const [row] = await db<[{ id: number }]>`
    INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, paid_by,
                          herd_group_id, pasture_id, equipment_id, job, notes)
    VALUES (${operationId}, ${e.expense_date}, ${e.category}, ${e.amount_cents}, ${e.vendor}, ${e.paid_by},
            ${e.herd_group_id}, ${e.pasture_id}, ${e.equipment_id}, ${e.job}, ${e.notes})
    RETURNING id`;
  return { ok: true, id: row.id };
}

/** Delete a manual expense (operation-scoped). Linked expenses are REJECTED —
 *  they must be reversed through their source record (deleteRestock / pasture
 *  activity), so accounting data is never orphaned. */
export const deleteExpense = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const id = Number((raw ?? null) as unknown);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the expense to delete.");
    return id;
  })
  .handler(async ({ data: id }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await deleteExpenseCore(sql(), auth.operationId, id);
    } catch (err) {
      console.error("deleteExpense failed:", err);
      return { ok: false, error: "We couldn't delete that expense right now. Please try again." };
    }
  });

/** Injectable expense delete — the exact SQL the deleteExpense handler runs. */
export async function deleteExpenseCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  id: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db<[{ source_type: string | null }]>`
    SELECT source_type FROM expenses WHERE id=${id} AND operation_id=${operationId}`;
  const reason = existing[0]?.source_type ?? null;
  if (reason !== null) {
    return {
      ok: false,
      error: "This expense came from a hay/feed restock or pasture activity — undo that record to remove it.",
    };
  }
  const deleted = await db`DELETE FROM expenses WHERE id=${id} AND operation_id=${operationId} RETURNING id`;
  if (deleted.length === 0) return { ok: false, error: "That expense no longer exists in this ranch." };
  return { ok: true };
}