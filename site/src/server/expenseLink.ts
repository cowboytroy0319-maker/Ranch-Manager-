// ============================================================================
// Ranch Manager Pro — Shared linked-expense service (financial workflow audit,
// Phase 2). ONE implementation of "create / follow / remove the ledger row a
// source record owns", so every cost-bearing module behaves the same way:
//
//   • feed.ts        → source_type 'restock'          (category hay_feed)
//   • pasture.ts     → source_type 'pasture_activity' (category land_pasture)
//   • equipment.ts   → source_type 'maintenance'      (category repairs_maintenance)
//   • equipment.ts   → source_type 'fuel_log'         (category fuel)
//
// The ledger write is part of the SOURCE record's own transaction: the caller
// passes its transaction handle (tx), so a failed expense rolls back the whole
// source write — "a failed expense never leaves a partial source record"
// (restock precedent, feed.ts insertLinkedExpense → moved here unchanged).
//
// Exactly-once is backed by the partial unique index expenses_source_once_uniq
// ON expenses (source_type, source_id) WHERE source_type IS NOT NULL AND
// source_id IS NOT NULL (0018_product_blocker.sql). That index covers ANY
// source_type value — including the new equipment ones — with no schema
// change, so one source record can never fund two ledger rows.
//
// The edit-time rule ("expense follows the source") is the restock precedent
// (feed.ts updateRestockCore 668–701): SELECT the linked row, then UPDATE that
// SAME row (never a second insert) when the cost stays > 0, INSERT when a cost
// appears on a record that had none, DELETE when the cost is removed or zero.
// ============================================================================

/** A Postgres client inside a transaction (db.begin provides tx). */
export type Tx = import("postgres").TransactionSql;

/** The ledger categories a linked expense can carry. */
export type LinkedExpenseCategory = "hay_feed" | "land_pasture" | "repairs_maintenance" | "fuel";

/** Every source_type a linked expense can claim. EXPENSE_SOURCES in
 *  types/expenses.ts is the client-facing list of the same values. */
export const LINKED_EXPENSE_SOURCE_TYPES = [
  "restock",
  "pasture_activity",
  "maintenance",
  "fuel_log",
] as const;
export type LinkedExpenseSourceType = (typeof LINKED_EXPENSE_SOURCE_TYPES)[number];

/** The registry: source_type → the ledger category its expense carries and the
 *  UI route that manages the source record (the /expenses "correct it there"
 *  jump). Adding a new linked source = one entry here + one in
 *  types/expenses.ts EXPENSE_SOURCES. */
export const EXPENSE_SOURCE_REGISTRY: Record<
  LinkedExpenseSourceType,
  { category: LinkedExpenseCategory; jump: string }
> = {
  restock: { category: "hay_feed", jump: "/feed" },
  pasture_activity: { category: "land_pasture", jump: "/pasture" },
  maintenance: { category: "repairs_maintenance", jump: "/equipment" },
  fuel_log: { category: "fuel", jump: "/equipment" },
};

/** The shape of a linked expense the caller wants created. */
export type LinkedExpenseInput = {
  category: LinkedExpenseCategory;
  expense_date: string;
  amount_cents: number;
  vendor: string | null;
  notes: string;
  source_type: LinkedExpenseSourceType;
  source_id: number;
  pasture_id?: number | null;
  equipment_id?: number | null;
};

export async function insertLinkedExpense(tx: Tx, operationId: number, e: LinkedExpenseInput): Promise<void> {
  try {
    await tx`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, notes,
                            pasture_id, equipment_id, source_type, source_id)
      VALUES (${operationId}, ${e.expense_date}, ${e.category}, ${e.amount_cents}, ${e.vendor}, ${e.notes},
              ${e.pasture_id ?? null}, ${e.equipment_id ?? null}, ${e.source_type}, ${e.source_id})`;
  } catch (err) {
    const code = (err as { code?: string }).code;
    const raw = (err as { message?: string }).message ?? "";
    if (code === "42703" && /source_type|source_id|paid_by/.test(raw)) {
      // The linked-expense columns are missing: this build is running against a
      // database that has not had migration 0018_product_blocker.sql applied.
      // The throw aborts the CALLER's transaction, so the source record is not
      // written either — "a failed expense never leaves a partial source record".
      console.error(
        `[expenseLink] linked expense refused: expenses.${/source_type/.test(raw) ? "source_type" : "source_id"} does not exist on the target database — ` +
          `migration 0018_product_blocker.sql is unapplied. The whole transaction was rolled back; the source record was NOT written. ` +
          `Check the deployment with \`bun run db:check-schema\`.`
      );
      throw new Error(
        "We couldn't record the expense for this entry, so nothing was changed. Please try again."
      );
    }
    throw err;
  }
}

/** The linked ledger row that claims a source record (0 or 1 rows — the unique
 *  index guarantees at most one). Callers must pass a transaction handle from
 *  the SAME transaction that writes the source record. */
export async function findLinkedExpense(
  tx: Tx,
  operationId: number,
  sourceType: LinkedExpenseSourceType,
  sourceId: number
): Promise<{ id: number; amount_cents: number }[]> {
  return await tx<{ id: number; amount_cents: number }[]>`
    SELECT id, amount_cents FROM expenses
    WHERE source_type = ${sourceType} AND source_id = ${sourceId} AND operation_id = ${operationId}`;
}

/** Which link columns actually exist on the target database (the D2 defensive
 *  probe; re-declared here as a structural type so expenseLink does not import
 *  the caching module a second time — callers pass the loaded value in). */
export type LinkColumns = { paidBy: boolean; sourceType: boolean; sourceId: boolean };

/** The edit-time rule (restock precedent, feed.ts updateRestockCore 668–701),
 *  shared by every edit core: the linked ledger row FOLLOWS the source record.
 *   cost > 0  → UPDATE the SAME expenses row (date, amount, vendor, notes;
 *               category and allocation columns untouched) or INSERT one if a
 *               legacy record has none yet.
 *   cost null/0 → DELETE the linked row (a removed cost must never leave a
 *               ledger line behind — and never a silent $0 row either).
 * Must run inside the caller's transaction. Returns whether an expense row is
 * linked to the source after the sync. */
export async function syncLinkedExpenseOnEdit(
  tx: Tx,
  operationId: number,
  args: {
    linkCols: LinkColumns;
    sourceType: LinkedExpenseSourceType;
    sourceId: number;
    costCents: number | null;
    expense: LinkedExpenseInput;
    /** The safe customer message thrown when a cost is present but the link
     *  columns are missing (0018 unapplied) — the edit is REFUSED so the cost
     *  is never silently dropped, and the throw rolls back the whole edit. */
    missingColumnsMessage: string;
    logLabel: string;
  }
): Promise<boolean> {
  const linked =
    args.linkCols.sourceType && args.linkCols.sourceId
      ? await findLinkedExpense(tx, operationId, args.sourceType, args.sourceId)
      : [];
  if (args.costCents !== null && args.costCents > 0) {
    if (!args.linkCols.sourceType || !args.linkCols.sourceId) {
      // Unreachable through the migrations (0018 adds the link columns before
      // any of these sources exist), but if it ever happens the edit is
      // refused rather than silently dropping the operator's expense.
      console.error(
        `[expenseLink] ${args.logLabel}: expenses.source_type/source_id are missing (migration 0018_product_blocker.sql not applied) — ` +
          `refusing the edit so a cost is never silently dropped. The transaction was rolled back.`
      );
      throw new Error(args.missingColumnsMessage);
    }
    if (linked.length > 0) {
      // The SAME ledger row is updated — never a second one (the unique index
      // would reject it anyway; the explicit same-row update is the contract).
      await tx`
        UPDATE expenses SET expense_date=${args.expense.expense_date}, amount_cents=${args.expense.amount_cents},
          vendor=${args.expense.vendor}, notes=${args.expense.notes}
        WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    } else {
      await insertLinkedExpense(tx, operationId, args.expense);
    }
    return true;
  }
  if (linked.length > 0) {
    await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
  }
  return false;
}

/** The void-time rule (restock precedent, feed.ts deleteRestockCore 789–792):
 *  the linked expense and the source record are removed TOGETHER, inside one
 *  transaction — never a partial void. Callers delete the record row
 *  themselves after this returns. */
export async function removeLinkedExpense(
  tx: Tx,
  operationId: number,
  args: { linkCols: LinkColumns; sourceType: LinkedExpenseSourceType; sourceId: number }
): Promise<boolean> {
  if (!args.linkCols.sourceType || !args.linkCols.sourceId) return false;
  const linked = await findLinkedExpense(tx, operationId, args.sourceType, args.sourceId);
  if (linked.length > 0) {
    await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    return true;
  }
  return false;
}
