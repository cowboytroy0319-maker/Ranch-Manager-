/**
 * ============================================================================
 * DEFENSIVE LINK-COLUMN DISCOVERY for the `expenses` ledger (audit defect D2).
 * ============================================================================
 *
 * The Expenses page used to hard-select `e.paid_by, e.source_type, e.source_id`
 * on every row. Those three columns arrive ONLY with migration
 * `0018_product_blocker.sql`, so on a database that is missing it ONE absent
 * column took the WHOLE ledger down (a `42601`/`42703` on the row query) instead
 * of degrading to "linked costs unavailable".
 *
 * This module asks the database which of those columns actually EXIST and lets
 * the callers build their SELECT defensively:
 *
 *   • present  → select the real column (linked records keep their badges);
 *   • absent   → select a typed NULL (the ledger still renders; the linked
 *                fields read as "no link" and the page degrades instead of
 *                failing).
 *
 * Resolution uses `to_regclass('expenses')`, which follows the connection's
 * `search_path` — so it reports the columns of the table the query itself would
 * resolve, not some other `expenses` table in another schema. (It deliberately
 * does NOT use `information_schema.columns`, which would report columns from
 * every schema the user can read.)
 *
 * The check NEVER reads a password and NEVER exposes a connection string: it
 * returns booleans only. The result is cached per process; call
 * `resetExpenseLinkColumnsCache()` after a schema change (tests do this).
 */

import type { sql as sqlClient } from "~/db";

/** Which of the 0018-only link columns exist on the resolved `expenses` table. */
export type ExpenseLinkColumns = {
  paidBy: boolean;
  sourceType: boolean;
  sourceId: boolean;
};

/** The 0018-only columns, in the order they were added. */
export const EXPENSE_LINK_COLUMN_NAMES = ["paid_by", "source_type", "source_id"] as const;

/** The migration that adds them — named in the refusal/log so the fix is obvious. */
export const EXPENSE_LINK_MIGRATION = "0018_product_blocker.sql";

/**
 * PURE mapping from "which columns exist" to "which SQL text to select". Kept
 * separate from the query so the degradation rules are unit-testable without a
 * database:
 *   null  → that column is unavailable; the caller selects a typed NULL.
 */
export const expenseLinkSelectColumns = (
  cols: ExpenseLinkColumns
): { paidBy: string | null; sourceType: string | null; sourceId: string | null } => ({
  paidBy: cols.paidBy ? "e.paid_by" : null,
  sourceType: cols.sourceType ? "e.source_type" : null,
  sourceId: cols.sourceId ? "e.source_id" : null,
});

/** True when every link column the ledger wants is present. */
export const hasAllExpenseLinkColumns = (cols: ExpenseLinkColumns): boolean =>
  cols.paidBy && cols.sourceType && cols.sourceId;

/** The query surface this module needs — the app's own client, or a
 *  transaction handle. Kept as the client's own type so callers can pass either
 *  `sql()` or an injected handle without casts. */
type ColumnQueryDb = ReturnType<typeof sqlClient>;

let cache: ExpenseLinkColumns | null = null;
let warned = false;

/** Columns of the resolved `expenses` table that this build knows how to use. */
export const loadExpenseLinkColumns = async (
  db: ColumnQueryDb
): Promise<ExpenseLinkColumns> => {
  if (cache) return cache;
  let present = new Set<string>();
  try {
    const rows = await db<{ attname: string }[]>`
      SELECT a.attname
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('expenses')
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname IN (${EXPENSE_LINK_COLUMN_NAMES[0]}, ${EXPENSE_LINK_COLUMN_NAMES[1]}, ${EXPENSE_LINK_COLUMN_NAMES[2]})`;
    present = new Set(rows.map((r) => r.attname));
  } catch {
    // Discovery itself must never be the thing that breaks a page: fall back to
    // "assume present" and let the caller's own error handling decide. A missing
    // `expenses` table at all is a different (deployment) fault.
    return { paidBy: true, sourceType: true, sourceId: true };
  }
  const cols: ExpenseLinkColumns = {
    paidBy: present.has("paid_by"),
    sourceType: present.has("source_type"),
    sourceId: present.has("source_id"),
  };
  cache = cols;
  if (!hasAllExpenseLinkColumns(cols) && !warned) {
    warned = true;
    console.warn(
      `[expenses] link columns missing (${EXPENSE_LINK_COLUMN_NAMES.filter((n) => !present.has(n)).join(", ")}) — ` +
        `the ledger is running in DEGRADED mode: manual expenses render, linked restock/pasture rows show as unlinked. ` +
        `This is a SCHEMA fault, not a transient one: apply migration ${EXPENSE_LINK_MIGRATION} ` +
        `(check with \`bun run db:check-schema\`).`
    );
  }
  return cols;
};

/** Forget the cached discovery (tests, and after applying a migration in-process). */
export const resetExpenseLinkColumnsCache = (): void => {
  cache = null;
  warned = false;
};
