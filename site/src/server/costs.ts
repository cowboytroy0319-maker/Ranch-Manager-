// ============================================================================
// Ranch Manager Pro — Costs server function (the only place that talks to the
// database for the costs dashboard).
//
// AUDIT D2 — the fuel de-dupe. PURCHASES carry ONE linked ledger row
// (source_type='fuel_log', category 'fuel'), so a purchase's dollars live in
// BOTH fuel_log and the expenses ledger. The dashboard's fuel stat and the
// "Fuel spend by equipment" card read the LEDGER first so the headline stats
// and the multi-dimensional allocation card (also ledger) always agree on one
// source — purchase money is never summed twice. Degradation mirrors the
// expenseSchema precedent: when the 0018 link columns are absent, or when no
// linked fuel ledger rows exist for the month (legacy purchases from before
// the linking shipped — reconciliation/backfill is a separately approved
// proposal), the reads fall back to fuel_log.
//
// THE OWNER'S TWO-PATH FUEL RULE (2026-10-20) keeps the money counted ONCE:
//   • a PURCHASE (station fill-up or bulk-tank delivery) is the ONLY kind that
//     ever creates an expense — so ledger money IS purchase money;
//   • a bulk-tank DRAW records usage only. A draw may still carry cost_cents
//     on the log for economics (fuel value consumed) — the FALLBACK read
//     therefore counts only record_kind='purchase' rows' cost, so a draw is
//     never counted as spend; its money was expensed once, at purchase time;
//   • GALLONS/usage totals include draws in BOTH paths: usage is usage, money
//     is money. (The headline gallon total sums fuel_log directly so draws
//     count; the per-equipment card allocates SPEND, so it follows the ledger.)
//
// The equipment PAGE's fuel totals (routes/equipment.tsx) stay on fuel_log:
// that page never reads the expenses ledger, so it cannot double-count, and
// fuel_log is the record an operator edits a fill-up through. There is no CSV
// export of financial data in the product today (only the blank template
// downloads), so "export totals" = this dashboard's numbers.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import { loadExpenseLinkColumns, loadFuelRecordKindColumn, type ExpenseLinkColumns } from "~/expenseSchema";

export type FuelByEquipment = {
  equipment_name: string;
  entries: number;
  cost_cents: number;
  gallons: number;
};

export type FuelSummary = {
  month: string; // YYYY-MM of the current month (DB clock)
  totalCents: number;
  totalEntries: number;
  gallons: number;
  byEquipment: FuelByEquipment[];
  /** Which source the summary came from — honest UI can say so. */
  source: "ledger" | "fuel_log";
};

export type CostData = {
  configured: boolean; // false when DATABASE_URL is missing
  error?: string; // short human-readable reason when configured but broken
  month: string;
  fuel: FuelSummary | null; // null when DATABASE_URL absent or no fuel this month
};

/** Injectable fuel summary — the exact queries getCostData runs (audit D2;
 *  two-path per the owner's 2026-10-20 rule).
 *  Ledger-first: purchase MONEY + entry count from expenses
 *  (source_type='fuel_log'), the month's gallon USAGE straight from fuel_log
 *  (draws included — usage is usage), per-equipment spend names via the ledger
 *  row's equipment allocation. Falls back to fuel_log when the link columns
 *  are missing (0018 unapplied) or the ledger has no fuel rows this month
 *  (legacy data). The fallback keeps the summary working without ever
 *  double-counting: fuel_log purchase rows are summed once, ledger rows once,
 *  and record_kind='draw' rows are EXCLUDED from every money figure (a draw's
 *  cost, when recorded for economics, is not spend — its money was expensed
 *  once, at purchase time) while their gallons still count as usage. */
export async function fuelSummaryCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  linkCols: Pick<ExpenseLinkColumns, "sourceType" | "sourceId">
): Promise<FuelSummary | null> {
  const monthRow = await db`select to_char(date_trunc('month', now()), 'YYYY-MM') as m`;
  const month = monthRow[0]?.m ?? new Date().toISOString().slice(0, 7);
  const ledgerUsable = linkCols.sourceType && linkCols.sourceId;
  // The two-path split needs the 0022 discriminator; without it every stored
  // row is a legacy purchase, so the unsplit reads below are still correct.
  const kindCol = await loadFuelRecordKindColumn(db);

  if (ledgerUsable) {
    const [summary, byEquip, usage] = await Promise.all([
      db<[{ total_cents: number; total_entries: number }]>`
        SELECT coalesce(SUM(x.amount_cents), 0)::int AS total_cents,
               COUNT(*)::int AS total_entries
        FROM expenses x
        WHERE x.operation_id = ${operationId}
          AND x.source_type = 'fuel_log'
          AND x.expense_date >= date_trunc('month', now())::date`,
      db<[{ equipment_name: string; entries: number; cost_cents: number; gallons: number }]>`
        SELECT coalesce(e.name, 'Unassigned') AS equipment_name,
               COUNT(*)::int AS entries,
               coalesce(SUM(x.amount_cents), 0)::int AS cost_cents,
               coalesce(SUM(f.gallons), 0)::float8 AS gallons
        FROM expenses x
        LEFT JOIN fuel_log f ON f.id = x.source_id
        LEFT JOIN equipment e ON e.id = x.equipment_id
        WHERE x.operation_id = ${operationId}
          AND x.source_type = 'fuel_log'
          AND x.expense_date >= date_trunc('month', now())::date
        GROUP BY 1
        ORDER BY cost_cents DESC`,
      // Full month usage from the log itself — draws count here even though
      // they never appear in the ledger (the spend card above stays the
      // per-machine allocation of PURCHASE money).
      db<[{ gallons: number }]>`
        SELECT coalesce(SUM(f.gallons), 0)::float8 AS gallons
        FROM fuel_log f
        WHERE f.operation_id = ${operationId}
          AND f.fuel_date >= date_trunc('month', now())::date`,
    ]);
    const s = summary[0];
    if (s.total_entries > 0) {
      return {
        month,
        totalCents: s.total_cents,
        totalEntries: s.total_entries,
        gallons: usage[0]?.gallons ?? 0,
        byEquipment: byEquip as unknown as FuelByEquipment[],
        source: "ledger",
      };
    }
    // No linked ledger rows this month → legacy purchases (or none at all).
    // Fall through to fuel_log so pre-linking dollars aren't invisible.
  }

  // The fuel_log fallback (also the legacy path): purchase rows' own money.
  // With the 0022 column present, FILTER keeps draws out of the money and the
  // entry count but IN the gallons; without the column, every row is a legacy
  // purchase, so the plain sums are already draws-free (draws cannot exist).
  const [summary, byEquip] = await Promise.all([
    kindCol
      ? db<[{ total_cents: number; total_entries: number; gallons: number }]>`
        SELECT coalesce(SUM(cost_cents) FILTER (WHERE record_kind <> 'draw'), 0)::int AS total_cents,
               COUNT(*) FILTER (WHERE record_kind <> 'draw')::int AS total_entries,
               coalesce(SUM(gallons), 0)::float8 AS gallons
        FROM fuel_log
        WHERE operation_id = ${operationId}
          AND fuel_date >= date_trunc('month', now())::date`
      : db<[{ total_cents: number; total_entries: number; gallons: number }]>`
        SELECT coalesce(SUM(cost_cents), 0)::int AS total_cents,
               COUNT(*)::int AS total_entries,
               coalesce(SUM(gallons), 0)::float8 AS gallons
        FROM fuel_log
        WHERE operation_id = ${operationId}
          AND fuel_date >= date_trunc('month', now())::date`,
    kindCol
      ? db<[{ equipment_name: string; entries: number; cost_cents: number; gallons: number }]>`
        SELECT coalesce(e.name, 'Unassigned') AS equipment_name,
               COUNT(*) FILTER (WHERE f.record_kind <> 'draw')::int AS entries,
               coalesce(SUM(f.cost_cents) FILTER (WHERE f.record_kind <> 'draw'), 0)::int AS cost_cents,
               coalesce(SUM(f.gallons) FILTER (WHERE f.record_kind <> 'draw'), 0)::float8 AS gallons
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
        WHERE f.operation_id = ${operationId}
          AND f.fuel_date >= date_trunc('month', now())::date
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE f.record_kind <> 'draw') > 0
        ORDER BY cost_cents DESC`
      : db<[{ equipment_name: string; entries: number; cost_cents: number; gallons: number }]>`
        SELECT coalesce(e.name, 'Unassigned') AS equipment_name,
               COUNT(*)::int AS entries,
               coalesce(SUM(f.cost_cents), 0)::int AS cost_cents,
               coalesce(SUM(f.gallons), 0)::float8 AS gallons
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
        WHERE f.operation_id = ${operationId}
          AND f.fuel_date >= date_trunc('month', now())::date
        GROUP BY 1
        ORDER BY cost_cents DESC`,
  ]);
  const s = summary[0];
  const fuel: FuelSummary = {
    month,
    totalCents: s.total_cents,
    totalEntries: s.total_entries,
    gallons: s.gallons,
    byEquipment: byEquip as unknown as FuelByEquipment[],
    source: "fuel_log",
  };
  return s.total_entries > 0 ? fuel : null;
}

export const getCostData = createServerFn().handler(async (): Promise<CostData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, month: "", fuel: null };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const linkCols = await loadExpenseLinkColumns(db);
    const fuel = await fuelSummaryCore(db, auth.operationId, linkCols);
    const monthRow = await db`select to_char(date_trunc('month', now()), 'YYYY-MM') as m`;
    const month = monthRow[0]?.m ?? new Date().toISOString().slice(0, 7);
    return { configured: true, month, fuel };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      month: new Date().toISOString().slice(0, 7),
      fuel: null,
    };
  }
});
