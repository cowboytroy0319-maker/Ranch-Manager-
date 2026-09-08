// ============================================================================
// Ranch Manager Pro — Product-blocker data layer tests (bun test, LOCAL
// Postgres only, never the owner's Neon).
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
//     bun test src/server/productBlocker.test.ts
//
// Covers (spec "Tests" items 1–8):
//   1. every new server write is operation-scoped (cross-op rejected)
//   2. expense validation (amount>0, vendor/payee required, category required)
//      + edit + delete behavior (linked delete blocked)
//   3. restock with cost → exactly one linked expense; without cost → none
//   4. retry/double-submit (same client_request_id) → no duplicate
//      expense/inventory
//   5. restock edit → linked expense updated; restock delete → expense removed
//      + inventory reversed
//   6. pasture activity with cost + record_expense → one linked expense;
//      without → none
//   7. moveLivestock: writes history, closes+opens assignment correctly,
//      rejects self-move, rejects cross-op ids, rejects negative head count
//   8. templates: expense CSV lists the 12 new categories (buildTemplateCsv)
//
// The createServerFn handlers run only inside a compiled app, so this suite
// exercises the injectable *Core functions (the exact SQL the handlers run)
// plus the real validators (parseExpenseInput, parseRestockInput,
// parsePastureActivityInput, parseMoveLivestockInput) — the same pattern the
// existing equipmentLogging / importLivestock suites use.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  deleteExpenseCore,
  parseExpenseInput,
  parseExpenseFilters,
  saveExpenseCore,
} from "./expenses";
import {
  deleteRestockCore,
  parseRestockEditInput,
  parseRestockInput,
  restockItemCore,
  updateRestockCore,
} from "./feed";
import {
  moveLivestockCore,
  parseMoveLivestockInput,
  parsePastureActivityInput,
  parsePastureInput,
  savePastureActivityCore,
  savePastureCore,
} from "./pasture";
import { buildTemplateCsv } from "./onboarding";
import { EXPENSE_CATEGORIES, CATEGORY_LABEL } from "~/types/expenses";
import { ACTIVITY_TYPES } from "~/types/pasture";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "productBlocker.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

const db = sql();
let opAId: number; // ranch A — the actor
let opBId: number; // ranch B — must be invisible to A
let hayAId: number; // A's hay stack
let feedAId: number; // A's feed item
let hayBId: number; // B's hay stack (cross-op target)
let pastureA1: number; // A's paddock 1
let pastureA2: number; // A's paddock 2
let pastureB1: number; // B's paddock (cross-op target)
let groupA1: number; // A's herd group 1
let groupB1: number; // B's herd group (cross-op target)

const inMonth = (): string => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await runMigrations(); // idempotent; includes 0018_product_blocker.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Product Blocker Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Product Blocker Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;

  const [ha] = await db<[{ id: number }]>`
    INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit, low_stock_threshold)
    VALUES (${opAId}, 'grass', 100, 'bales', 10) RETURNING id`;
  const [fa] = await db<[{ id: number }]>`
    INSERT INTO feed_inventory (operation_id, name, category, quantity, unit, low_stock_threshold)
    VALUES (${opAId}, 'Beef Grower', 'grain', 2000, 'lbs', 500) RETURNING id`;
  const [hb] = await db<[{ id: number }]>`
    INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit, low_stock_threshold)
    VALUES (${opBId}, 'alfalfa', 50, 'bales', 5) RETURNING id`;
  hayAId = ha.id;
  feedAId = fa.id;
  hayBId = hb.id;

  const [p1] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres, status) VALUES (${opAId}, 'A-East', 60, 'resting') RETURNING id`;
  const [p2] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres, status) VALUES (${opAId}, 'A-West', 45, 'resting') RETURNING id`;
  const [pb] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres, status) VALUES (${opBId}, 'B-Home', 80, 'grazing') RETURNING id`;
  pastureA1 = p1.id;
  pastureA2 = p2.id;
  pastureB1 = pb.id;

  const [g1] = await db<[{ id: number }]>`
    INSERT INTO herd_groups (operation_id, name, species) VALUES (${opAId}, 'A-Cow Herd', 'cattle') RETURNING id`;
  const [gb] = await db<[{ id: number }]>`
    INSERT INTO herd_groups (operation_id, name, species) VALUES (${opBId}, 'B-Herd', 'cattle') RETURNING id`;
  groupA1 = g1.id;
  groupB1 = gb.id;
});

afterAll(async () => {
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

// ---------------------------------------------------------------------------
// 1. Operation scoping — cross-op writes are rejected
// ---------------------------------------------------------------------------

describe("operation scoping — every new write is scoped to the session operation", () => {
  test("restockItemCore rejects an inventory item from ANOTHER operation", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `cross-op-restock-${Date.now()}`,
      item_kind: "hay",
      item_id: hayBId, // B's hay — must not exist for A
      quantity: 10,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 5000,
      vendor: "Test",
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no longer exists");
    // B's inventory is untouched.
    const [bHay] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayBId}`;
    expect(Number(bHay.quantity)).toBe(50);
  });

  test("savePastureActivityCore rejects a pasture from ANOTHER operation", async () => {
    const res = await savePastureActivityCore(db, opAId, {
      pasture_id: pastureB1,
      activity_date: inMonth(),
      activity_type: "fencing",
      cost_cents: 10000,
      notes: null,
      record_expense: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no longer exists");
  });

  test("moveLivestockCore rejects a destination pasture AND a group from ANOTHER operation", async () => {
    const res1 = await moveLivestockCore(db, opAId, {
      herd_group_id: groupA1,
      to_pasture_id: pastureB1, // B's pasture
      move_date: inMonth(),
      head_count: 10,
      notes: null,
    });
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error).toContain("destination pasture");

    const res2 = await moveLivestockCore(db, opAId, {
      herd_group_id: groupB1, // B's group
      to_pasture_id: pastureA1,
      move_date: inMonth(),
      head_count: 10,
      notes: null,
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toContain("herd/group");
  });

  test("saveExpenseCore / deleteExpenseCore can't touch another operation's expense", async () => {
    const [bExp] = await db<[{ id: number }]>`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
      VALUES (${opBId}, ${inMonth()}, 'fuel', 1234, 'B Fuel Stop') RETURNING id`;
    const edit = await saveExpenseCore(db, opAId, {
      id: bExp.id,
      expense_date: inMonth(),
      category: "fuel",
      amount_cents: 9999,
      vendor: "Sneaky",
      paid_by: null,
      herd_group_id: null,
      pasture_id: null,
      equipment_id: null,
      job: null,
      notes: null,
    });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error).toContain("no longer exists");
    const del = await deleteExpenseCore(db, opAId, bExp.id);
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error).toContain("no longer exists");
    // B's expense is still intact with its original amount.
    const [row] = await db<[{ amount_cents: number }]>`SELECT amount_cents FROM expenses WHERE id=${bExp.id}`;
    expect(row.amount_cents).toBe(1234);
    await db`DELETE FROM expenses WHERE id=${bExp.id}`;
  });
});

// ---------------------------------------------------------------------------
// 2. Expense validation + edit + delete behavior
// ---------------------------------------------------------------------------

describe("expense validation — amount > 0, payee/vendor required, category required", () => {
  const base = {
    expense_date: "2026-09-15",
    category: "hay_feed",
    amount_cents: "5000",
    vendor: "Chappell Feed",
  };

  test("parses a valid manual expense (paid_by optional, categories new)", () => {
    const out = parseExpenseInput({ ...base, paid_by: "T Bar T", category: "land_pasture" });
    expect(out.amount_cents).toBe(5000);
    expect(out.vendor).toBe("Chappell Feed");
    expect(out.paid_by).toBe("T Bar T");
    expect(out.category).toBe("land_pasture");
  });

  test("rejects amount <= 0 before any DB write", () => {
    for (const bad of [0, -5, "0", "-1"]) {
      expect(() => parseExpenseInput({ ...base, amount_cents: bad })).toThrow(
        "Expense amount must be greater than zero."
      );
    }
    expect(() => parseExpenseInput({ ...base, amount_cents: "" })).toThrow(
      "Expense amount must be greater than zero."
    );
  });

  test("rejects a missing vendor/payee", () => {
    expect(() => parseExpenseInput({ ...base, vendor: "" })).toThrow("Payee / description is required.");
    expect(() => parseExpenseInput({ ...base, vendor: "   " })).toThrow("Payee / description is required.");
  });

  test("rejects a missing/unknown category (no silent 'other' default)", () => {
    const { category: _c, ...noCat } = base;
    expect(() => parseExpenseInput(noCat)).toThrow("Pick a category for this expense.");
    expect(() => parseExpenseInput({ ...base, category: "random_stuff" })).toThrow(
      "Pick a category for this expense."
    );
  });

  test("rejects an invalid date", () => {
    expect(() => parseExpenseInput({ ...base, expense_date: "09/15/2026" })).toThrow(
      "Expense date must be a valid date"
    );
  });

  test("saveExpenseCore persists a manual expense with paid_by", async () => {
    const res = await saveExpenseCore(db, opAId, parseExpenseInput({ ...base, paid_by: "T Bar T" }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const [row] = await db<[{ paid_by: string | null; category: string }]>`
      SELECT paid_by, category FROM expenses WHERE id=${res.id}`;
    expect(row.paid_by).toBe("T Bar T");
    expect(row.category).toBe("hay_feed");
    await db`DELETE FROM expenses WHERE id=${res.id}`;
  });

  test("edit updates fields; linked expenses can't be edited", async () => {
    const [exp] = await db<[{ id: number }]>`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
      VALUES (${opAId}, '2026-09-01', 'fuel', 2000, 'Fuel Stop') RETURNING id`;
    const edited = await saveExpenseCore(db, opAId, {
      id: exp.id,
      expense_date: "2026-09-02",
      category: "veterinary",
      amount_cents: 9999,
      vendor: "Ag Vet",
      paid_by: null,
      herd_group_id: null,
      pasture_id: null,
      equipment_id: null,
      job: null,
      notes: null,
    });
    expect(edited.ok).toBe(true);
    const [after] = await db<[{ category: string; amount_cents: number }]>`
      SELECT category, amount_cents FROM expenses WHERE id=${exp.id}`;
    expect(after.category).toBe("veterinary");
    expect(after.amount_cents).toBe(9999);

    // A linked expense (source_type set, e.g. from a restock) must NOT be editable.
    const [linked] = await db<[{ id: number }]>`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, source_type, source_id)
      VALUES (${opAId}, '2026-09-01', 'hay_feed', 5000, 'Feed Co', 'restock', ${exp.id})
      RETURNING id`;
    const badEdit = await saveExpenseCore(db, opAId, {
      id: linked.id,
      expense_date: "2026-09-02",
      category: "hay_feed",
      amount_cents: 99999,
      vendor: "Sneaky",
      paid_by: null,
      herd_group_id: null,
      pasture_id: null,
      equipment_id: null,
      job: null,
      notes: null,
    });
    expect(badEdit.ok).toBe(false);
    if (!badEdit.ok) expect(badEdit.error).toContain("edit it from that record instead");
    await db`DELETE FROM expenses WHERE id=${linked.id}`;
    await db`DELETE FROM expenses WHERE id=${exp.id}`;
  });

  test("deleteExpenseCore deletes a manual expense but BLOCKS a linked expense", async () => {
    const [manual] = await db<[{ id: number }]>`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
      VALUES (${opAId}, '2026-09-01', 'labor', 3000, 'Crew') RETURNING id`;
    const delOk = await deleteExpenseCore(db, opAId, manual.id);
    expect(delOk.ok).toBe(true);
    expect((await db`SELECT id FROM expenses WHERE id=${manual.id}`).length).toBe(0);

    const [linked] = await db<[{ id: number }]>`
      INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, source_type, source_id)
      VALUES (${opAId}, '2026-09-01', 'land_pasture', 8000, null, 'pasture_activity', ${manual.id})
      RETURNING id`;
    const delBlocked = await deleteExpenseCore(db, opAId, linked.id);
    expect(delBlocked.ok).toBe(false);
    if (!delBlocked.ok) expect(delBlocked.error).toContain("undo that record");
    expect((await db`SELECT id FROM expenses WHERE id=${linked.id}`).length).toBe(1);
    await db`DELETE FROM expenses WHERE id=${linked.id}`;
  });

  test("parseExpenseFilters rejects from>to and normalizes blanks", () => {
    expect(() => parseExpenseFilters({ from: "2026-09-20", to: "2026-09-01" })).toThrow(
      "start date can't be after the end date"
    );
    const f = parseExpenseFilters({ from: "", to: "", category: "" });
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
    expect(f.category).toBeNull();
    const c = parseExpenseFilters({ from: "2026-09-01", to: "2026-09-30", category: "fuel" });
    expect(c.from).toBe("2026-09-01");
    expect(c.category).toBe("fuel");
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. Restock: cost → exactly one linked expense; no cost → none;
//        same client_request_id → NO duplicate expense/inventory
// ---------------------------------------------------------------------------

describe("restockItem — linked expense exactly-once + idempotent retry", () => {
  test("hay restock WITH cost creates exactly ONE linked expense and adds inventory", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `restock-cost-${Date.now()}`,
      item_kind: "hay",
      item_id: hayAId,
      quantity: 20,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 70000,
      vendor: "Johnson Hay",
      notes: "second cutting",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.expense_created).toBe(true);
    expect(res.duplicate).toBe(false);

    const [hay] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayAId}`;
    expect(Number(hay.quantity)).toBe(120); // 100 + 20

    const linked = await db<[{ id: number; category: string; source_type: string; source_id: number; vendor: string | null }]>`
      SELECT id, category, source_type, source_id, vendor FROM expenses
      WHERE source_type='restock' AND source_id=${res.id} AND operation_id=${opAId}`;
    expect(linked.length).toBe(1);
    expect(linked[0].category).toBe("hay_feed");
    expect(linked[0].vendor).toBe("Johnson Hay");
    await db`DELETE FROM expenses WHERE id=${linked[0].id}`;
    await db`DELETE FROM restock_log WHERE id=${res.id}`;
    await db`UPDATE hay_inventory SET quantity = 100 WHERE id=${hayAId}`;
  });

  test("feed restock WITHOUT cost creates ZERO expenses and adds inventory", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `restock-nocost-${Date.now()}`,
      item_kind: "feed",
      item_id: feedAId,
      quantity: 500,
      unit: "lbs",
      restock_date: inMonth(),
      total_cost_cents: null,
      vendor: null,
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.expense_created).toBe(false);

    const [feed] = await db<[{ quantity: string }]>`SELECT quantity FROM feed_inventory WHERE id=${feedAId}`;
    expect(Number(feed.quantity)).toBe(2500); // 2000 + 500
    const expenses = await db`SELECT id FROM expenses WHERE source_type='restock' AND source_id=${res.id} AND operation_id=${opAId}`;
    expect(expenses.length).toBe(0);
    await db`DELETE FROM restock_log WHERE id=${res.id}`;
    await db`UPDATE feed_inventory SET quantity = 2000 WHERE id=${feedAId}`;
  });

  test("re-running the SAME client_request_id is a duplicate — no new inventory, no new expense", async () => {
    const reqId = `restock-retry-${Date.now()}`;
    const first = await restockItemCore(db, opAId, {
      client_request_id: reqId,
      item_kind: "hay",
      item_id: hayAId,
      quantity: 10,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 30000,
      vendor: "Dup Co",
      notes: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);

    const [hayBefore] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayAId}`;
    const expenseCountBefore = (await db`
      SELECT id FROM expenses WHERE source_type='restock' AND source_id=${first.ok ? first.id : 0} AND operation_id=${opAId}`).length;

    // Double-submit / refresh / back-nav — the SAME request id again.
    const retry = await restockItemCore(db, opAId, {
      client_request_id: reqId,
      item_kind: "hay",
      item_id: hayAId,
      quantity: 999, // a big number that must NOT be applied
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 999999,
      vendor: "Dup Co",
      notes: null,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.error);
    expect(retry.duplicate).toBe(true);
    expect(retry.id).toBe(first.ok ? first.id : 0);

    const [hayAfter] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayAId}`;
    expect(Number(hayAfter.quantity)).toBe(Number(hayBefore.quantity)); // unchanged by the retry
    const expenseCountAfter = (await db`
      SELECT id FROM expenses WHERE source_type='restock' AND source_id=${first.ok ? first.id : 0} AND operation_id=${opAId}`).length;
    expect(expenseCountAfter).toBe(expenseCountBefore); // still exactly one
    expect(expenseCountAfter).toBe(1);

    // The restock_log row itself must have kept the ORIGINAL quantity/cost — the
    // retry must not have mutated it either.
    const [log] = await db<[{ quantity: string; total_cost_cents: number }]>`
      SELECT quantity, total_cost_cents FROM restock_log WHERE id=${first.ok ? first.id : 0}`;
    expect(Number(log.quantity)).toBe(10);
    expect(log.total_cost_cents).toBe(30000);

    await db`DELETE FROM expenses WHERE source_type='restock' AND source_id=${first.ok ? first.id : 0} AND operation_id=${opAId}`;
    await db`DELETE FROM restock_log WHERE id=${first.ok ? first.id : 0}`;
    await db`UPDATE hay_inventory SET quantity = 100 WHERE id=${hayAId}`;
  });
});

// ---------------------------------------------------------------------------
// 5. Restock edit + delete
// ---------------------------------------------------------------------------

describe("updateRestock / deleteRestock — consistent ledger + inventory math", () => {
  test("editing quantity recomputes inventory delta; editing cost upserts the linked expense", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `restock-edit-${Date.now()}`,
      item_kind: "hay",
      item_id: hayAId,
      quantity: 10,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 20000,
      vendor: "Edit Co",
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const restockId = res.id;

    // Edit: quantity 10 → 25 (delta +15), cost 20000 → 45000, vendor change.
    const edited = await updateRestockCore(db, opAId, {
      id: restockId,
      quantity: 25,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 45000,
      vendor: "Edit Co 2",
      notes: "edited",
    });
    expect(edited.ok).toBe(true);

    const [hay] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayAId}`;
    expect(Number(hay.quantity)).toBe(125); // 100 + (25 - 10) net delta applied on edit → 115; then +10 re-logged by the cost-reapply → 125
    const expRows = await db<{ id: number; amount_cents: number; vendor: string | null }[]>`
      SELECT id, amount_cents, vendor FROM expenses WHERE source_type='restock' AND source_id=${restockId} AND operation_id=${opAId}`;
    expect(expRows.length).toBe(1);
    expect(expRows[0].amount_cents).toBe(45000);
    expect(expRows[0].vendor).toBe("Edit Co 2");

    // Edit cost to 0 → the linked expense is DELETED, inventory delta still applies.
    const noCost = await updateRestockCore(db, opAId, {
      id: restockId,
      quantity: 25,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: 0,
      vendor: null,
      notes: null,
    });
    expect(noCost.ok).toBe(true);
    expect((await db`SELECT id FROM expenses WHERE source_type='restock' AND source_id=${restockId} AND operation_id=${opAId}`).length).toBe(0);

    await db`DELETE FROM restock_log WHERE id=${restockId}`;
    await db`UPDATE hay_inventory SET quantity = 100 WHERE id=${hayAId}`;
  });

  test("deleting a restock reverses inventory and removes the linked expense", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `restock-delete-${Date.now()}`,
      item_kind: "feed",
      item_id: feedAId,
      quantity: 300,
      unit: "lbs",
      restock_date: inMonth(),
      total_cost_cents: 15000,
      vendor: "Delete Me",
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const [feedMid] = await db<[{ quantity: string }]>`SELECT quantity FROM feed_inventory WHERE id=${feedAId}`;
    expect(Number(feedMid.quantity)).toBe(2300);

    const del = await deleteRestockCore(db, opAId, res.id);
    expect(del.ok).toBe(true);
    if (!del.ok) throw new Error(del.error);
    expect(del.linked_expense_removed).toBe(true);
    expect((await db`SELECT id FROM restock_log WHERE id=${res.id}`).length).toBe(0);
    expect((await db`SELECT id FROM expenses WHERE source_type='restock' AND source_id=${res.id} AND operation_id=${opAId}`).length).toBe(0);
    const [feedAfter] = await db<[{ quantity: string }]>`SELECT quantity FROM feed_inventory WHERE id=${feedAId}`;
    expect(Number(feedAfter.quantity)).toBe(2000); // reversed back
  });

  test("deleting a restock whose cost was blank reverses inventory only", async () => {
    const res = await restockItemCore(db, opAId, {
      client_request_id: `restock-delete-nocost-${Date.now()}`,
      item_kind: "hay",
      item_id: hayAId,
      quantity: 15,
      unit: "bales",
      restock_date: inMonth(),
      total_cost_cents: null,
      vendor: null,
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const del = await deleteRestockCore(db, opAId, res.id);
    expect(del.ok).toBe(true);
    if (!del.ok) throw new Error(del.error);
    expect(del.linked_expense_removed).toBe(false);
    const [hay] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id=${hayAId}`;
    expect(Number(hay.quantity)).toBe(100);
  });

  test("parseRestockInput / parseRestockEditInput reject bad input", () => {
    expect(() => parseRestockInput({ client_request_id: "x", item_kind: "hay", item_id: 1, quantity: 0, restock_date: "2026-09-01" })).toThrow("greater than zero");
    expect(() => parseRestockInput({ item_kind: "hay", item_id: 1, quantity: 5, restock_date: "2026-09-01" })).toThrow("request id");
    expect(() => parseRestockEditInput({ id: 1, quantity: 5, restock_date: "" })).toThrow("Restock date is required");
  });
});

// ---------------------------------------------------------------------------
// 6. Pasture activity → linked land/pasture expense
// ---------------------------------------------------------------------------

describe("savePastureActivity — linked expense rules", () => {
  test("activity with cost + record_expense=true creates ONE linked expense", async () => {
    const res = await savePastureActivityCore(db, opAId, {
      pasture_id: pastureA1,
      activity_date: inMonth(),
      activity_type: "fencing",
      cost_cents: 85000,
      notes: "replaced east fence",
      record_expense: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.expense_created).toBe(true);

    const [activity] = await db<[{ activity_type: string; cost_cents: number }]>`
      SELECT activity_type, cost_cents FROM pasture_activities WHERE id=${res.id}`;
    expect(activity.activity_type).toBe("fencing");
    expect(activity.cost_cents).toBe(85000);

    const linked = await db<[{ id: number; category: string; source_type: string; source_id: number; pasture_id: number; notes: string }]>`
      SELECT id, category, source_type, source_id, pasture_id, notes FROM expenses
      WHERE source_type='pasture_activity' AND source_id=${res.id} AND operation_id=${opAId}`;
    expect(linked.length).toBe(1);
    expect(linked[0].category).toBe("land_pasture");
    expect(linked[0].pasture_id).toBe(pastureA1);
    expect(linked[0].notes).toContain("fencing");
    await db`DELETE FROM expenses WHERE id=${linked[0].id}`;
    await db`DELETE FROM pasture_activities WHERE id=${res.id}`;
  });

  test("activity without cost, or record_expense=false, creates NO expense", async () => {
    const a1 = await savePastureActivityCore(db, opAId, {
      pasture_id: pastureA1,
      activity_date: inMonth(),
      activity_type: "inspection",
      cost_cents: null,
      notes: null,
      record_expense: true,
    });
    expect(a1.ok).toBe(true);
    if (!a1.ok) throw new Error(a1.error);
    expect(a1.expense_created).toBe(false);
    expect((await db`SELECT id FROM expenses WHERE source_type='pasture_activity' AND source_id=${a1.id} AND operation_id=${opAId}`).length).toBe(0);

    const a2 = await savePastureActivityCore(db, opAId, {
      pasture_id: pastureA1,
      activity_date: inMonth(),
      activity_type: "spraying",
      cost_cents: 12000,
      notes: null,
      record_expense: false, // operator unchecked the box
    });
    expect(a2.ok).toBe(true);
    if (!a2.ok) throw new Error(a2.error);
    expect(a2.expense_created).toBe(false);
    expect((await db`SELECT id FROM expenses WHERE source_type='pasture_activity' AND source_id=${a2.id} AND operation_id=${opAId}`).length).toBe(0);

    await db`DELETE FROM pasture_activities WHERE id=${a1.id}`;
    await db`DELETE FROM pasture_activities WHERE id=${a2.id}`;
  });

  test("parsePastureActivityInput validates the 10 activity types + non-negative cost", () => {
    expect(() => parsePastureActivityInput({ pasture_id: 1, activity_date: "2026-09-01", activity_type: "nope", cost_cents: 1 })).toThrow("Pick an activity type.");
    expect(() => parsePastureActivityInput({ pasture_id: 1, activity_date: "2026-09-01", activity_type: "fencing", cost_cents: -5 })).toThrow("Cost can't be negative.");
    const out = parsePastureActivityInput({ pasture_id: 1, activity_date: "2026-09-01", activity_type: "water_system", cost_cents: "", record_expense: false });
    expect(out.cost_cents).toBeNull();
    expect(out.record_expense).toBe(false);
    expect(ACTIVITY_TYPES.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 7. moveLivestock — history, assignments, self-move, cross-op, negative heads
// ---------------------------------------------------------------------------

describe("moveLivestock — group-based movement rules", () => {
  test("moves a group: closes the active assignment, opens the new one, writes history", async () => {
    // Seed A's group into pasture A1 (the "current" assignment).
    const [asg] = await db<[{ id: number }]>`
      INSERT INTO pasture_assignments (operation_id, pasture_id, herd_group_id, assigned_at)
      VALUES (${opAId}, ${pastureA1}, ${groupA1}, '2026-09-01') RETURNING id`;

    const res = await moveLivestockCore(db, opAId, {
      herd_group_id: groupA1,
      to_pasture_id: pastureA2,
      move_date: "2026-09-10",
      head_count: 42,
      notes: "south rotation",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    // Old assignment closed on the move date.
    const [oldAsg] = await db<[{ ended_at: string | null }]>`
      SELECT to_char(ended_at, 'YYYY-MM-DD') AS ended_at FROM pasture_assignments WHERE id=${asg.id}`;
    expect(oldAsg.ended_at).toBe("2026-09-10");
    // New assignment opened on the same date, still active.
    const [newAsg] = await db<[{ pasture_id: number; ended_at: string | null }]>`
      SELECT pasture_id, ended_at FROM pasture_assignments
      WHERE herd_group_id=${groupA1} AND ended_at IS NULL AND operation_id=${opAId}`;
    expect(newAsg.pasture_id).toBe(pastureA2);
    expect(newAsg.ended_at).toBeNull();
    // History row: from A1 → A2 with head count + notes.
    const [move] = await db<[{ from_pasture_id: number | null; to_pasture_id: number; head_count: number; notes: string | null }]>`
      SELECT from_pasture_id, to_pasture_id, head_count, notes FROM livestock_movements WHERE id=${res.id}`;
    expect(move.from_pasture_id).toBe(pastureA1);
    expect(move.to_pasture_id).toBe(pastureA2);
    expect(move.head_count).toBe(42);
    expect(move.notes).toBe("south rotation");
  });

  test("rejects a SELF-move (group already in the destination)", async () => {
    const res = await moveLivestockCore(db, opAId, {
      herd_group_id: groupA1,
      to_pasture_id: pastureA2, // the group is currently there after the move above
      move_date: "2026-09-11",
      head_count: 42,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("already in this pasture");
    // Still exactly one active assignment for the group.
    const active = await db`
      SELECT id FROM pasture_assignments WHERE herd_group_id=${groupA1} AND ended_at IS NULL AND operation_id=${opAId}`;
    expect(active.length).toBe(1);
  });

  test("rejects a negative head count before hitting the DB", () => {
    expect(() =>
      parseMoveLivestockInput({ herd_group_id: groupA1, to_pasture_id: pastureA1, move_date: "2026-09-12", head_count: -3 })
    ).toThrow("Head count can't be negative.");
  });

  test("a group with NO active assignment moves from off-pasture (from NULL)", async () => {
    const [freshGroup] = await db<[{ id: number }]>`
      INSERT INTO herd_groups (operation_id, name, species) VALUES (${opAId}, 'A-Weaners', 'cattle') RETURNING id`;
    const res = await moveLivestockCore(db, opAId, {
      herd_group_id: freshGroup.id,
      to_pasture_id: pastureA1,
      move_date: "2026-09-12",
      head_count: 12,
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const [move] = await db<[{ from_pasture_id: number | null }]>`SELECT from_pasture_id FROM livestock_movements WHERE id=${res.id}`;
    expect(move.from_pasture_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Templates — the expense CSV carries the 12 new categories
// ---------------------------------------------------------------------------

describe("templates — expense CSV reflects the NEW 12 categories + field guidance", () => {
  test("EXPENSE_CATEGORIES is the exact 12-value set", () => {
    expect(EXPENSE_CATEGORIES).toEqual([
      "hay_feed",
      "livestock",
      "fuel",
      "repairs_maintenance",
      "veterinary",
      "supplies",
      "labor",
      "utilities",
      "land_pasture",
      "insurance",
      "taxes_fees",
      "other",
    ]);
    expect(CATEGORY_LABEL.hay_feed).toBe("Hay & feed");
    expect(CATEGORY_LABEL.repairs_maintenance).toBe("Repairs & maintenance");
    expect(CATEGORY_LABEL.taxes_fees).toBe("Taxes / fees");
  });

  test("expense template lists every new category in header comment + legend", () => {
    const csv = buildTemplateCsv("expenses");
    for (const c of EXPENSE_CATEGORIES) expect(csv).toContain(c);
    expect(csv).toContain("vendor");
    expect(csv).toContain("Payee / description");
    expect(csv).toContain("paid_by");
    expect(csv).not.toContain("vet_health");
    expect(csv).toContain("No formulas or macros");
  });

  test("other templates stay correct (no regression)", () => {
    for (const slug of ["livestock", "pastures", "hay-feed", "equipment", "tasks"] as const) {
      const csv = buildTemplateCsv(slug);
      expect(csv.startsWith("# Ranch Manager Pro — ")).toBe(true);
      expect(csv).toContain("# FIELD DEFINITIONS");
    }
  });
});

// ---------------------------------------------------------------------------
// Pasture parse extensions (spec: acres optional >0; new fields)
// ---------------------------------------------------------------------------

describe("parsePastureInput — extended fields", () => {
  test("size_acres is optional now but must be >0 when present", () => {
    expect(parsePastureInput({ name: "P", size_acres: "" }).size_acres).toBeNull();
    expect(() => parsePastureInput({ name: "P", size_acres: 0 })).toThrow("greater than zero");
    expect(() => parsePastureInput({ name: "P", size_acres: -1 })).toThrow("greater than zero");
    expect(parsePastureInput({ name: "P", size_acres: "42.5" }).size_acres).toBe(42.5);
  });

  test("defaults for water_status / condition; rejects unknown enums", () => {
    const plain = parsePastureInput({ name: "P" });
    expect(plain.water_status).toBe("unknown");
    expect(plain.condition).toBe("good");
    expect(() => parsePastureInput({ name: "P", water_status: "parched" })).toThrow();
    expect(() => parsePastureInput({ name: "P", condition: "lush" })).toThrow();
    const full = parsePastureInput({ name: "P", capacity_heads: 120, pasture_type: "native", water_status: "needs_attention", condition: "fair" });
    expect(full.capacity_heads).toBe(120);
    expect(full.pasture_type).toBe("native");
    expect(full.water_status).toBe("needs_attention");
  });

  test("savePastureCore persists the new fields incl. NULL size_acres", async () => {
    const res = await savePastureCore(db, opAId, parsePastureInput({ name: "A-Unknown Acres", size_acres: "", pasture_type: "trap", capacity_heads: 25, water_status: "good", condition: "excellent" }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    const [row] = await db<[{ size_acres: string | null; pasture_type: string | null; capacity_heads: number | null; water_status: string; condition: string }]>`
      SELECT size_acres, pasture_type, capacity_heads, water_status, condition FROM pastures WHERE id=${res.id}`;
    expect(row.size_acres).toBeNull();
    expect(row.pasture_type).toBe("trap");
    expect(row.capacity_heads).toBe(25);
    expect(row.water_status).toBe("good");
    expect(row.condition).toBe("excellent");
    await db`DELETE FROM pastures WHERE id=${res.id}`;
  });
});