// ============================================================================
// RESTOCK → EXPENSES RELIABILITY SUITE (stage 2)
//
// Proves the owner's guarantees at the level the browser E2E then re-proves
// through the real UI:
//
//   1. one transaction — a FAILING EXPENSE rolls the inventory back too, so a
//      failed expense never leaves a partial inventory update;
//   2. a double-submit / retry never creates a duplicate expense;
//   3. the linked expense is one row, and edit UPDATES that row (no second row);
//   4. void reverses inventory and removes that same row;
//   5. the inventory-safety rule — never clamp; a negative correction rolls
//      back with a message naming the units;
//   6. the form contract (exact strings the owner specified) and the unit as a
//      REAL control (a mismatched unit is refused, never silently ignored);
//   7. audit defect D2 — the ledger read degrades instead of dying when a link
//      column is missing;
//   8. audit defect D3 — a permanent schema fault is distinguishable in the
//      server log while the customer-facing copy stays unchanged;
//   9. audit defect D4 — the deploy-time schema gate refuses a release and names
//      the missing migration.
//
// The createServerFn handlers run only inside a compiled app, so this suite
// exercises the injectable *Core functions (the exact SQL the handlers run)
// plus the real validators, the same pattern the productBlocker suite uses.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { evaluateSchema, REQUIRED_OBJECTS, requiredObjectKey } from "../../db/schemaCheck";
import { closeDb, sql } from "~/db";
import { sanitizeDbError, isPermanentSchemaFault, PREVIEW_PENDING_MESSAGE, GENERIC_DB_ERROR_MESSAGE } from "~/dbErrors";
import { expenseLinkSelectColumns, loadExpenseLinkColumns, resetExpenseLinkColumnsCache } from "~/expenseSchema";
import { loadExpenseRows } from "./expenses";
import {
  deleteRestockCore,
  INVENTORY_BELOW_ZERO_ERROR,
  insertLinkedExpense,
  parseRestockInput,
  restockItemCore,
  restockUnitError,
  updateRestockCore,
} from "./feed";
import {
  parseCostToCents,
  restockSubmitLabel,
  RESTOCK_ADD_EXPENSE_LABEL,
  RESTOCK_COST_HELPER_TEXT,
  RESTOCK_INVENTORY_ONLY_LABEL,
  RESTOCK_SUBMIT_INVENTORY_ONLY,
  RESTOCK_SUBMIT_WITH_EXPENSE,
  validateRestockForm,
} from "~/components/feed/restockUI";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "restockReliability.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}
const db = sql();
let opId: number;
let hayId: number;
const today = (): string => new Date().toISOString().slice(0, 10);

const hayQty = async (id = hayId): Promise<number> => {
  const [row] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${id}`;
  return Number(row.quantity);
};
const linked = async (restockId: number) =>
  await db<{ id: number; amount_cents: number; vendor: string | null }[]>`
    SELECT id, amount_cents, vendor FROM expenses
    WHERE operation_id = ${opId} AND source_type = 'restock' AND source_id = ${restockId}`;

beforeAll(async () => {
  await runMigrations();
  const [op] = await db<{ id: number }[]>`
    INSERT INTO operations (name) VALUES ('Restock Reliability Ranch') RETURNING id`;
  opId = op.id;
  const [hay] = await db<{ id: number }[]>`
    INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit, low_stock_threshold)
    VALUES (${opId}, 'grass', 80, 'bales', 10) RETURNING id`;
  hayId = hay.id;
});

afterAll(async () => {
  await db`DELETE FROM expenses WHERE operation_id = ${opId}`;
  await db`DELETE FROM restock_log WHERE operation_id = ${opId}`;
  await db`DELETE FROM hay_inventory WHERE operation_id = ${opId}`;
  await db`DELETE FROM operations WHERE id = ${opId}`;
  await closeDb();
});

// ---------------------------------------------------------------------------
// The form contract — exact strings and the submit-label rule
// ---------------------------------------------------------------------------
describe("Add Restock form contract (owner-specified)", () => {
  test("helper text under the cost field is exact", () => {
    expect(RESTOCK_COST_HELPER_TEXT).toBe("Saving this restock will add this amount to Expenses.");
  });
  test("the two linked-expense choices are exact", () => {
    expect(RESTOCK_ADD_EXPENSE_LABEL).toBe("Add linked expense");
    expect(RESTOCK_INVENTORY_ONLY_LABEL).toBe("Inventory only — no expense");
  });
  test("submit label tracks the cost", () => {
    expect(restockSubmitLabel(31250, true)).toBe("Save restock & add expense");
    expect(restockSubmitLabel(null, true)).toBe(RESTOCK_SUBMIT_INVENTORY_ONLY);
    expect(restockSubmitLabel(31250, false)).toBe(RESTOCK_SUBMIT_INVENTORY_ONLY);
    expect(RESTOCK_SUBMIT_WITH_EXPENSE).toBe("Save restock & add expense");
  });
  test("dollars → cents is exact and never invents a value", () => {
    expect(parseCostToCents("312.50")).toBe(31250);
    expect(parseCostToCents("0")).toBeNull();
    expect(parseCostToCents("")).toBeNull();
    expect(parseCostToCents("abc")).toBeNull();
  });
  test("a blank cost is only allowed through the explicit inventory-only choice", () => {
    const base = { quantity: 25 as const, unit: "bales", restock_date: "2026-09-26", costDollars: "", vendor: "Triple C Hay", notes: "", addExpense: true };
    expect(validateRestockForm({ ...base, addExpense: true }, { unit: "bales" })).toContain("Inventory only — no expense");
    expect(validateRestockForm({ ...base, addExpense: false }, { unit: "bales" })).toBeNull();
    expect(validateRestockForm({ ...base, costDollars: "312.50" }, { unit: "bales" })).toBeNull();
  });
  test("a unit that contradicts the item is refused client-side", () => {
    const problem = validateRestockForm(
      { quantity: 25, unit: "tons", restock_date: "2026-09-26", costDollars: "312.50", vendor: "", notes: "", addExpense: true },
      { unit: "bales" }
    );
    expect(problem).toContain("counted in bales");
  });
});

// ---------------------------------------------------------------------------
// The unit is a real control (server side)
// ---------------------------------------------------------------------------
describe("unit is a real control", () => {
  test("restockUnitError names both units and allows a blank unit", () => {
    expect(restockUnitError("bales", "bales")).toBeNull();
    expect(restockUnitError("", "bales")).toBeNull();
    expect(restockUnitError("tons", "bales")).toContain("counted in bales");
  });
  test("a restock naming the wrong unit is REFUSED and changes nothing", async () => {
    const before = await hayQty();
    const res = await restockItemCore(db, opId, {
      client_request_id: crypto.randomUUID(),
      item_kind: "hay",
      item_id: hayId,
      quantity: 25,
      unit: "tons",
      restock_date: today(),
      total_cost_cents: 31250,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("counted in bales");
    expect(await hayQty()).toBe(before);
    expect((await db`SELECT id FROM restock_log WHERE operation_id = ${opId}`).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Guarantee 1 — one transaction: a failing expense rolls inventory back
// ---------------------------------------------------------------------------
describe("one transaction (guarantee 1)", () => {
  test("a failed expense leaves NO partial inventory update and no restock row", async () => {
    const before = await hayQty();
    // A negative cost is impossible through the validator; calling the core
    // directly makes the ledger INSERT fail on its CHECK constraint, which is
    // exactly the "expense fails" case the owner cares about.
    let threw = false;
    try {
      await restockItemCore(db, opId, {
        client_request_id: crypto.randomUUID(),
        item_kind: "hay",
        item_id: hayId,
        quantity: 25,
        unit: "bales",
        restock_date: today(),
        total_cost_cents: -1,
        vendor: "Triple C Hay",
        notes: null,
      });
    } catch {
      threw = true;
    }
    expect(await hayQty()).toBe(before);
    expect((await db`SELECT id FROM restock_log WHERE operation_id = ${opId}`).length).toBe(0);
    expect((await db`SELECT id FROM expenses WHERE operation_id = ${opId}`).length).toBe(0);
    // Either it surfaced as a thrown db error (sanitized for the customer) or it
    // returned a safe failure — both mean "nothing was written".
    expect(threw || (await hayQty()) === before).toBe(true);
  });
  test("insertLinkedExpense translates a missing link column into a safe message", async () => {
    // Simulate the driver error a database missing 0018 would raise: a tagged
    // template call that rejects with SQLSTATE 42703 (undefined_column).
    const fakeTx = (() => {
      const err = new Error('column "source_type" of relation "expenses" does not exist') as Error & {
        code?: string;
      };
      err.code = "42703";
      return Promise.reject(err);
    }) as unknown as Parameters<typeof insertLinkedExpense>[0];
    let message = "";
    try {
      await insertLinkedExpense(fakeTx, opId, {
        category: "hay_feed",
        expense_date: today(),
        amount_cents: 31250,
        vendor: "Triple C Hay",
        notes: "Hay restock",
        source_type: "restock",
        source_id: 1,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("nothing was changed");
    expect(message).not.toContain("column");
  });
});

// ---------------------------------------------------------------------------
// Guarantees 2–4 — exactly one expense, no duplicate on retry, edit/void
// ---------------------------------------------------------------------------
describe("exactly one linked expense (guarantees 2-4)", () => {
  test("create → one expense; a same-key retry duplicates nothing", async () => {
    const before = await hayQty();
    const key = crypto.randomUUID();
    const input = {
      client_request_id: key,
      item_kind: "hay" as const,
      item_id: hayId,
      quantity: 25,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 31250,
      vendor: "Triple C Hay",
      notes: null,
    };
    const first = await restockItemCore(db, opId, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.expense_created).toBe(true);
    expect(await hayQty()).toBe(before + 25);
    const rows = await linked(first.id);
    expect(rows.length).toBe(1);
    expect(rows[0].amount_cents).toBe(31250);
    expect(rows[0].vendor).toBe("Triple C Hay");

    const retry = await restockItemCore(db, opId, input);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.duplicate).toBe(true);
    expect(await hayQty()).toBe(before + 25);
    expect((await linked(first.id)).length).toBe(1);

    // edit → SAME row, updated in place
    const edited = await updateRestockCore(db, opId, {
      id: first.id,
      quantity: 30,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 35000,
      vendor: "Triple C Hay",
      notes: "corrected invoice",
    });
    expect(edited.ok).toBe(true);
    expect(await hayQty()).toBe(before + 30);
    const afterEdit = await linked(first.id);
    expect(afterEdit.length).toBe(1);
    expect(afterEdit[0].id).toBe(rows[0].id);
    expect(afterEdit[0].amount_cents).toBe(35000);
    // and the ledger read sees it as a LINKED row
    const ledger = await loadExpenseRows(db, opId, { from: null, to: null, category: null });
    const ledgerRow = ledger.find((r) => r.id === afterEdit[0].id);
    expect(ledgerRow?.linked).toBe(true);
    expect(ledgerRow?.source_type).toBe("restock");

    // void → inventory reversed, the SAME row gone
    const voided = await deleteRestockCore(db, opId, first.id);
    expect(voided.ok).toBe(true);
    if (voided.ok) expect(voided.linked_expense_removed).toBe(true);
    expect(await hayQty()).toBe(before);
    expect((await linked(first.id)).length).toBe(0);
  });

  test("inventory only (no cost) creates NO expense row at all", async () => {
    const before = await hayQty();
    const res = await restockItemCore(db, opId, {
      client_request_id: crypto.randomUUID(),
      item_kind: "hay",
      item_id: hayId,
      quantity: 5,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: null,
      vendor: null,
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect(await hayQty()).toBe(before + 5);
    expect((await linked(res.id)).length).toBe(0);
    const voided = await deleteRestockCore(db, opId, res.id);
    expect(voided.ok).toBe(true);
    if (voided.ok) expect(voided.linked_expense_removed).toBe(false);
    expect(await hayQty()).toBe(before);
  });

  test("a $0 cost is treated as no expense (never a silent $0 row)", async () => {
    const parsed = parseRestockInput({
      client_request_id: crypto.randomUUID(),
      item_kind: "hay",
      item_id: hayId,
      quantity: 1,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 0,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(parsed.total_cost_cents).toBeNull();
    const res = await restockItemCore(db, opId, parsed);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect((await linked(res.id)).length).toBe(0);
    await deleteRestockCore(db, opId, res.id);
  });

  test("void that would go below zero is refused and changes nothing", async () => {
    const before = await hayQty();
    const res = await restockItemCore(db, opId, {
      client_request_id: crypto.randomUUID(),
      item_kind: "hay",
      item_id: hayId,
      quantity: 25,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 31250,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Use up the restock, then try to void it: the reversal would go negative.
    await db`UPDATE hay_inventory SET quantity = 10 WHERE id = ${hayId}`;
    const voided = await deleteRestockCore(db, opId, res.id);
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.error).toBe(INVENTORY_BELOW_ZERO_ERROR);
    expect(await hayQty()).toBe(10);
    expect((await linked(res.id)).length).toBe(1);
    await db`UPDATE hay_inventory SET quantity = ${before} WHERE id = ${hayId}`;
    await deleteRestockCore(db, opId, res.id);
  });
});

// ---------------------------------------------------------------------------
// D2 — the ledger read degrades instead of dying on a missing link column
// ---------------------------------------------------------------------------
describe("D2 — the expenses ledger read is defensive", () => {
  test("expenseLinkSelectColumns maps missing columns to nulls (pure)", () => {
    expect(expenseLinkSelectColumns({ paidBy: true, sourceType: true, sourceId: true })).toEqual({
      paidBy: "e.paid_by",
      sourceType: "e.source_type",
      sourceId: "e.source_id",
    });
    expect(expenseLinkSelectColumns({ paidBy: false, sourceType: false, sourceId: false })).toEqual({
      paidBy: null,
      sourceType: null,
      sourceId: null,
    });
  });

  test("the ledger row query still returns rows when expenses has no link columns", async () => {
    const SCHEMA = "degraded_expenses_probe";
    await db`DROP SCHEMA IF EXISTS ${db(SCHEMA)} CASCADE`;
    await db.unsafe(`CREATE SCHEMA ${SCHEMA}`);
    await db.unsafe(
      `CREATE TABLE ${SCHEMA}.expenses (LIKE public.expenses INCLUDING ALL)`
    );
    // The pre-0018 shape: no paid_by / source_type / source_id, no unique index.
    await db.unsafe(
      `ALTER TABLE ${SCHEMA}.expenses DROP COLUMN paid_by, DROP COLUMN source_type, DROP COLUMN source_id`
    );
    await db.unsafe(
      `INSERT INTO ${SCHEMA}.expenses (operation_id, expense_date, category, amount_cents, vendor, notes)
       VALUES (${opId}, CURRENT_DATE, 'hay_feed', 31250, 'Triple C Hay', 'degraded-mode probe')`
    );
    try {
      resetExpenseLinkColumnsCache();
      const rows = await db.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO ${SCHEMA}, public`);
        // NOTE: no explicit column list passed → discovery runs INSIDE this
        // transaction, where `to_regclass('expenses')` resolves to the
        // column-less probe table. A hard-coded select would throw here.
        return await loadExpenseRows(tx as unknown as ReturnType<typeof sql>, opId, {
          from: null,
          to: null,
          category: null,
        });
      });
      expect(rows.length).toBe(1);
      expect(rows[0].amount_cents).toBe(31250);
      expect(rows[0].source_type).toBeNull();
      expect(rows[0].linked).toBe(false);
      expect(rows[0].paid_by).toBeNull();
      const cols = await db.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO ${SCHEMA}, public`);
        resetExpenseLinkColumnsCache();
        return await loadExpenseLinkColumns(tx as unknown as ReturnType<typeof sql>);
      });
      expect(cols).toEqual({ paidBy: false, sourceType: false, sourceId: false });
    } finally {
      resetExpenseLinkColumnsCache();
      await db.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    }
  });

  test("on the migrated database all three link columns are present", async () => {
    resetExpenseLinkColumnsCache();
    const cols = await loadExpenseLinkColumns(db);
    expect(cols).toEqual({ paidBy: true, sourceType: true, sourceId: true });
  });
});

// ---------------------------------------------------------------------------
// D3 — permanent schema faults are distinguishable in the log, not in the copy
// ---------------------------------------------------------------------------
describe("D3 — permanent schema fault logging", () => {
  test("classifies SQLSTATEs", () => {
    expect(isPermanentSchemaFault("42P01")).toBe(true);
    expect(isPermanentSchemaFault("42703")).toBe(true);
    expect(isPermanentSchemaFault("08006")).toBe(false);
    expect(isPermanentSchemaFault(undefined)).toBe(false);
  });

  test("the customer-facing message is unchanged and the log says DEPLOYMENT fault", () => {
    const err = new Error('relation "restock_log" does not exist') as Error & { code?: string };
    err.code = "42P01";
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let safe: Error;
    try {
      safe = sanitizeDbError(err);
    } finally {
      console.error = original;
    }
    const log = lines.join("\n");
    expect(safe!.message).toMatch(
      new RegExp(`^(${PREVIEW_PENDING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${GENERIC_DB_ERROR_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`)
    );
    expect(log).toContain("PERMANENT SCHEMA FAULT");
    expect(log).toContain("DEPLOYMENT fault");
    expect(log).toContain("42P01");
    // A transient fault must NOT be labelled permanent.
    const transient = new Error("connection terminated unexpectedly") as Error & { code?: string };
    transient.code = "08006";
    const lines2: string[] = [];
    console.error = (...args: unknown[]) => {
      lines2.push(args.map(String).join(" "));
    };
    try {
      sanitizeDbError(transient);
    } finally {
      console.error = original;
    }
    expect(lines2.join("\n")).not.toContain("PERMANENT SCHEMA FAULT");
  });
});

// ---------------------------------------------------------------------------
// D4 — the deploy-time schema gate
// ---------------------------------------------------------------------------
describe("D4 — deploy-time schema gate", () => {
  const allMigrations = ["0018_product_blocker.sql", "0019_owner_complimentary_access.sql", "0020_password_reset.sql"];

  test("passes only when every migration is applied AND every object exists", () => {
    const ok = evaluateSchema({
      localMigrations: allMigrations,
      appliedMigrations: allMigrations,
      presentObjects: REQUIRED_OBJECTS.map(requiredObjectKey),
    });
    expect(ok.ok).toBe(true);
    expect(ok.migrationsToApply).toEqual([]);
  });

  test("names 0018 when it is unapplied (the exact owner outage)", () => {
    const res = evaluateSchema({
      localMigrations: allMigrations,
      appliedMigrations: ["0019_owner_complimentary_access.sql", "0020_password_reset.sql"],
      presentObjects: [],
    });
    expect(res.ok).toBe(false);
    expect(res.missingMigrations).toContain("0018_product_blocker.sql");
    expect(res.migrationsToApply).toContain("0018_product_blocker.sql");
  });

  test("catches drift: bookkeeping says applied but the objects are gone", () => {
    const res = evaluateSchema({
      localMigrations: allMigrations,
      appliedMigrations: allMigrations,
      presentObjects: REQUIRED_OBJECTS.filter((o) => o.name !== "restock_log").map(requiredObjectKey),
    });
    expect(res.ok).toBe(false);
    expect(res.missingObjects.map((o) => o.name)).toEqual(["restock_log"]);
    expect(res.migrationsToApply).toEqual(["0018_product_blocker.sql"]);
  });
});
