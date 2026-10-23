// ============================================================================
// Ranch Manager Pro — the owner's TWO-PATH fuel model (2026-10-20 rule).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/ranch_ci \
//     bun test src/server/equipmentFuelTwoPath.test.ts
//
// WHAT THIS PROVES (production-shaped: REAL Postgres, REAL cores, REAL tables)
// --------------------------------------------------------------------------
//   P1  a fuel PURCHASE (pump or bulk-tank delivery) writes the log row AND
//       exactly ONE linked expense (category 'fuel', source_type 'fuel_log',
//       the operator's own vendor/notes), inside one transaction.
//   P2  a bulk-tank DRAW writes a USAGE row and ZERO expenses — even with a
//       cost recorded on the log for economics and create_expense:true.
//   P3  a double-tap (same client_request_id) applies nothing twice — for
//       BOTH kinds (one row, one expense at most, duplicate:true).
//   P4  editing a PURCHASE updates the SAME expense row (id stable, amount
//       follows); editing a DRAW updates the log only and never invents an
//       expense; asking an edit to CONVERT kinds is refused, never applied.
//   P5  voiding a PURCHASE removes both halves; voiding a DRAW removes the
//       usage log only.
//   P6  dashboard de-dupe on a MIXED month (purchase + draw + station fill):
//       money counted once (purchases only), gallons counted fully.
//   P7  the fuel_log FALLBACK counts only purchase rows' cost — a draw's
//       economics cost is never spend — while its gallons still count.
//   P8  legacy rows: the 0022 backfill/default marks existing rows
//       'purchase', and the CHECK refuses any other kind.
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  deleteFuelCore,
  logFuelCore,
  updateFuelCore,
  type FuelLogInput,
} from "~/server/equipment";
import { fuelSummaryCore } from "~/server/costs";

type TestDb = ReturnType<typeof sql>;

let db: TestDb;
let opAId: number; // the two-path ranch
let opBId: number; // fallback-path ranch (no ledger fuel rows)
let opCId: number; // dedicated mixed-month ranch (summary math must be clean)
let eqAId: number;
let eqCId: number;
const today = (): string => new Date().toISOString().slice(0, 10);

/** The ONE linked ledger row claiming a source record (0 or 1 — the partial
 *  unique index expenses_source_once_uniq guarantees at most one). */
const linkedExpense = async (operationId: number, sourceId: number) =>
  await db<{ id: number; category: string; amount_cents: number; vendor: string | null; notes: string | null }[]>`
    SELECT id, category, amount_cents, vendor, notes
    FROM expenses
    WHERE operation_id = ${operationId} AND source_type = 'fuel_log' AND source_id = ${sourceId}`;

const fuelRow = async (id: number) => {
  const [row] = await db<
    { id: number; record_kind: string; cost_cents: number | null; gallons: string; notes: string | null }[]
  >`SELECT id, record_kind, cost_cents, gallons::text AS gallons, notes FROM fuel_log WHERE id = ${id}`;
  return row;
};

const purchaseInput = (over: Partial<FuelLogInput>): FuelLogInput => ({
  client_request_id: crypto.randomUUID(),
  create_expense: true,
  record_kind: "purchase",
  equipment_id: eqAId,
  fuel_date: today(),
  fuel_type: "diesel",
  gallons: 50,
  cost_cents: 15000,
  location: "Co-op station",
  notes: "winter blend",
  ...over,
});

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "equipmentFuelTwoPath.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "The owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent — includes 0022_fuel_two_path.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Two-Path Fuel Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Two-Path Fuel Ranch B') RETURNING id`;
  const [c] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Two-Path Fuel Ranch C') RETURNING id`;
  opAId = a.id;
  opBId = b.id;
  opCId = c.id;
  const [ea] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category) VALUES (${opAId}, 'A Feed Truck', 'truck') RETURNING id`;
  eqAId = ea.id;
  const [ec] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category) VALUES (${opCId}, 'C Feed Truck', 'truck') RETURNING id`;
  eqCId = ec.id;
});

afterAll(async () => {
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId} OR id = ${opCId}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

// P1 — purchase: the log row AND exactly one linked expense
describe("P1 — a fuel purchase expenses exactly once", () => {
  test("a $150.00 bulk-tank delivery writes the row AND the ONE ledger row", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ cost_cents: 15000, location: "Fuel supplier", notes: "300 gal to the tank" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(true);
    expect(res.record_kind).toBe("purchase");
    const [exp] = await linkedExpense(opAId, res.id);
    expect(exp).toBeDefined();
    expect(exp.category).toBe("fuel");
    expect(exp.amount_cents).toBe(15000);
    expect(exp.vendor).toBe("Fuel supplier");
    expect(exp.notes).toBe("300 gal to the tank");
    const row = await fuelRow(res.id);
    expect(row.record_kind).toBe("purchase");
  });
});

// P2 — draw: usage only, never an expense
describe("P2 — a bulk-tank draw never expenses", () => {
  test("a 40-gal draw WITH a recorded cost and create_expense:true writes usage only", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ record_kind: "draw", gallons: 40, cost_cents: 9600, create_expense: true, location: "Main tank", notes: "tractor refill" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect(res.record_kind).toBe("draw");
    const row = await fuelRow(res.id);
    expect(row.record_kind).toBe("draw");
    expect(row.cost_cents).toBe(9600); // economics recorded on the log
    expect(await linkedExpense(opAId, res.id)).toHaveLength(0);
  });

  test("a draw with NO cost is also just a usage row", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ record_kind: "draw", cost_cents: null, gallons: 12 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect(await linkedExpense(opAId, res.id)).toHaveLength(0);
  });
});

// P3 — double-tap idempotency for BOTH kinds
describe("P3 — a repeated submit applies nothing twice (both kinds)", () => {
  test("purchase double-tap: one row, one expense, duplicate:true", async () => {
    const reqId = crypto.randomUUID();
    const first = await logFuelCore(db, opAId, purchaseInput({ client_request_id: reqId, cost_cents: 6000 }));
    const again = await logFuelCore(db, opAId, purchaseInput({ client_request_id: reqId, cost_cents: 6000 }));
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.expense_created).toBe(true); // honest: the one expense exists
    expect(await linkedExpense(opAId, first.id)).toHaveLength(1);
    const rows = await db`SELECT count(*)::int AS n FROM fuel_log WHERE client_request_id = ${reqId} AND operation_id = ${opAId}`;
    expect(rows[0].n).toBe(1);
  });

  test("draw double-tap: one usage row, zero expenses, duplicate:true", async () => {
    const reqId = crypto.randomUUID();
    const first = await logFuelCore(db, opAId, purchaseInput({ client_request_id: reqId, record_kind: "draw", cost_cents: 8000 }));
    const again = await logFuelCore(db, opAId, purchaseInput({ client_request_id: reqId, record_kind: "draw", cost_cents: 8000 }));
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.expense_created).toBe(false);
    expect(await linkedExpense(opAId, first.id)).toHaveLength(0);
    const rows = await db`SELECT count(*)::int AS n FROM fuel_log WHERE client_request_id = ${reqId} AND operation_id = ${opAId}`;
    expect(rows[0].n).toBe(1);
  });
});

// P4 — edits: purchase syncs the SAME expense; draw edits the log only; conversion refused
describe("P4 — edits follow the kind", () => {
  test("purchase edit updates the SAME expense row (id stable)", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ cost_cents: 7500 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [before] = await linkedExpense(opAId, res.id);
    const edit = await updateFuelCore(db, opAId, {
      id: res.id,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 55,
      cost_cents: 8250,
      location: "Co-op station",
      notes: "corrected gallons",
      meter_hours: null,
      meter_miles: null,
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.expense_linked).toBe(true);
    expect(edit.record_kind).toBe("purchase");
    const [after] = await linkedExpense(opAId, res.id);
    expect(after.id).toBe(before.id); // the SAME ledger row
    expect(after.amount_cents).toBe(8250);
  });

  test("draw edit updates the log only — no expense appears, even with cost set", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ record_kind: "draw", gallons: 30, cost_cents: 7200 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const edit = await updateFuelCore(db, opAId, {
      id: res.id,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 35,
      cost_cents: 8400,
      location: "Main tank",
      notes: "pump meter",
      meter_hours: null,
      meter_miles: null,
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.expense_linked).toBe(false);
    expect(edit.record_kind).toBe("draw");
    const row = await fuelRow(res.id);
    expect(row.gallons).toBe("35");
    expect(row.cost_cents).toBe(8400);
    expect(await linkedExpense(opAId, res.id)).toHaveLength(0); // never invented
  });

  test("editing a draw INTO a purchase is refused, nothing applied", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ record_kind: "draw", gallons: 20, cost_cents: null }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const edit = await updateFuelCore(db, opAId, {
      id: res.id,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 20,
      cost_cents: 5000,
      location: "Main tank",
      notes: null,
      meter_hours: null,
      meter_miles: null,
      record_kind: "purchase", // the forbidden conversion
    });
    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.error).toContain("can't be edited into a fuel purchase");
    const row = await fuelRow(res.id);
    expect(row.record_kind).toBe("draw"); // unchanged
    expect(row.cost_cents).toBeNull(); // the refused edit applied nothing
    expect(await linkedExpense(opAId, res.id)).toHaveLength(0);
  });

  test("editing a purchase INTO a draw is refused too", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ cost_cents: 3000 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await linkedExpense(opAId, res.id)).toHaveLength(1);
    const edit = await updateFuelCore(db, opAId, {
      id: res.id,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 50,
      cost_cents: 3000,
      location: "Co-op station",
      notes: null,
      meter_hours: null,
      meter_miles: null,
      record_kind: "draw",
    });
    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.error).toContain("can't be edited into a bulk-tank draw");
    expect(await linkedExpense(opAId, res.id)).toHaveLength(1); // the expense survives
  });
});

// P5 — voids
describe("P5 — voids follow the kind", () => {
  test("purchase void removes BOTH halves", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ cost_cents: 4200 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await linkedExpense(opAId, res.id)).toHaveLength(1);
    const v = await deleteFuelCore(db, opAId, res.id);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.linked_expense_removed).toBe(true);
    expect(v.record_kind).toBe("purchase");
    expect(await fuelRow(res.id)).toBeUndefined();
    expect(await linkedExpense(opAId, res.id)).toHaveLength(0);
  });

  test("draw void removes the usage log only (nothing else to remove)", async () => {
    const res = await logFuelCore(db, opAId, purchaseInput({ record_kind: "draw", gallons: 15, cost_cents: 3600 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const v = await deleteFuelCore(db, opAId, res.id);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.linked_expense_removed).toBe(false);
    expect(v.record_kind).toBe("draw");
    expect(await fuelRow(res.id)).toBeUndefined();
  });
});

// P6 + P7 — the dashboard de-dupe on a mixed month
describe("P6/P7 — dashboard money counted once, usage counted fully", () => {
  test("ledger path: purchase + station fill + draw ⇒ money = purchases only, gallons = everything", async () => {
    // Ranch C, this month: two expensed purchases + one (expensive-on-paper)
    // draw. Ranch C is dedicated, so the summary math is exactly these rows.
    const p1 = await logFuelCore(db, opCId, purchaseInput({ equipment_id: eqCId, gallons: 50, cost_cents: 15000 }));
    const p2 = await logFuelCore(db, opCId, purchaseInput({ equipment_id: null, gallons: 20, cost_cents: 6000, location: "Station" }));
    const d1 = await logFuelCore(db, opCId, purchaseInput({ record_kind: "draw", equipment_id: eqCId, gallons: 30, cost_cents: 9000 }));
    expect(p1.ok && p2.ok && d1.ok).toBe(true);
    const summary = await fuelSummaryCore(db, opCId, { sourceType: true, sourceId: true });
    expect(summary).not.toBeNull();
    if (!summary) return;
    expect(summary.source).toBe("ledger");
    // Money: 15000 + 6000 = 21000 ONCE — the draw's 9000 never counts.
    expect(summary.totalCents).toBe(21000);
    expect(summary.totalEntries).toBe(2); // the two expenses
    // Usage: 50 + 20 + 30 = 100 gal — the draw counts.
    expect(summary.gallons).toBe(100);
  });

  test("fallback path: record-only purchase + draw ⇒ cost counts purchases only, gallons fully", async () => {
    // Ranch B never creates ledger fuel rows this month: a record-only
    // purchase and a draw — the ledger has nothing, so the read falls back.
    const rp = await logFuelCore(db, opBId, purchaseInput({ equipment_id: null, gallons: 40, cost_cents: 12000, create_expense: false }));
    const dr = await logFuelCore(db, opBId, purchaseInput({ record_kind: "draw", equipment_id: null, gallons: 25, cost_cents: 6000 }));
    expect(rp.ok && dr.ok).toBe(true);
    const summary = await fuelSummaryCore(db, opBId, { sourceType: true, sourceId: true });
    expect(summary).not.toBeNull();
    if (!summary) return;
    expect(summary.source).toBe("fuel_log");
    expect(summary.totalCents).toBe(12000); // the draw's 6000 is NOT spend
    expect(summary.totalEntries).toBe(1); // purchases only
    expect(summary.gallons).toBe(65); // 40 + 25 — usage is usage
    expect(summary.byEquipment).toHaveLength(1); // the draw-alone bucket is dropped
    expect(summary.byEquipment[0].cost_cents).toBe(12000);
  });
});

// P8 — the 0022 legacy backfill and the CHECK
describe("P8 — legacy rows are purchases; the CHECK refuses any other kind", () => {
  test("a raw legacy-shaped INSERT (no record_kind) reads back 'purchase'", async () => {
    const [row] = await db<[{ id: number; record_kind: string }]>`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents, location, notes, client_request_id)
      SELECT ${opAId}, NULL, ${today()}, 'diesel', 5, NULL, NULL, NULL, ${"legacy-" + crypto.randomUUID()}
      RETURNING id, record_kind`;
    expect(row.record_kind).toBe("purchase");
    await db`DELETE FROM fuel_log WHERE id = ${row.id}`;
  });

  test("the column is NOT NULL and the CHECK rejects garbage", async () => {
    const col = await db<{ attname: string; attnotnull: boolean }[]>`
      SELECT attname, attnotnull FROM pg_attribute
      WHERE attrelid = to_regclass('fuel_log') AND attname = 'record_kind' AND NOT attisdropped`;
    expect(col).toHaveLength(1);
    expect(col[0].attnotnull).toBe(true);
    let refused = false;
    try {
      await db`INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents, client_request_id, record_kind)
        VALUES (${opAId}, NULL, ${today()}, 'diesel', 1, NULL, ${"bad-" + crypto.randomUUID()}, 'theft')`;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});
