// ============================================================================
// Ranch Manager Pro — Equipment expense-linking tests (financial workflow
// audit Phase 2, S1–S7 of root-cause-and-environment.md §6).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/ranch_ci \
//     bun test src/server/equipmentExpenseLinking.test.ts
//
// WHAT THIS PROVES (production-shaped: REAL Postgres, REAL cores, REAL tables)
// --------------------------------------------------------------------------
//   S1  a repair with a cost ⇒ exactly ONE linked ledger row
//       (category 'repairs_maintenance', source_type 'maintenance',
//       source_id = the maintenance row, amount/date/vendor/equipment right).
//   S2  a fuel fill with a cost ⇒ the same shape (category 'fuel',
//       source_type 'fuel_log').
//   S3  a repeated submit with the SAME client_request_id ⇒ one row + one
//       expense + duplicate:true — and the composite UNIQUE constraint
//       (uq_maintenance_records_operation_request / uq_fuel_log_operation_request,
//       migration 0021) backs the true race at the DB level.
//   S5  an edit updates the SAME expense row (id stable); blanking the cost
//       deletes it; re-adding a cost inserts exactly one.
//   S6  a void removes the linked expense AND the record together, nothing
//       partial; a record without an expense voids cleanly too.
//   S7  no cost ⇒ NO expense (never a silent $0 ledger row); the explicit
//       create_expense:false choice writes the record only.
//       + one transaction: a forced expense failure rolls the record insert
//         back (nothing partial survives).
//       + operation scoping is preserved (cross-ranch writes/edits refused).
//   S8-regression  restock + pasture linked-expense behavior is UNCHANGED by
//       moving the insert into the shared expenseLink module.
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  logFuelCore,
  logMaintenanceCore,
  updateFuelCore,
  updateMaintenanceCore,
  deleteFuelCore,
  deleteMaintenanceCore,
} from "~/server/equipment";
import { fuelSummaryCore } from "~/server/costs";
import {
  deleteExpenseCore,
  linkedExpenseDeleteRefusal,
  linkedExpenseEditRefusal,
  saveExpenseCore,
  type ExpenseInput,
} from "~/server/expenses";
import { restockItemCore, updateRestockCore, deleteRestockCore } from "~/server/feed";
import {
  savePastureActivityCore,
  updatePastureActivityCore,
  deletePastureActivityCore,
} from "~/server/pasture";

type TestDb = ReturnType<typeof sql>;

let db: TestDb;
let opAId: number;
let opBId: number;
let eqAId: number; // Ranch A's truck
let eqBId: number; // Ranch B's truck (must be invisible to A's writes)
let hayId: number; // for the restock regression block
let pastureId: number; // for the pasture regression block
const today = (): string => new Date().toISOString().slice(0, 10);

/** The ONE linked ledger row claiming a source record (0 or 1 — the partial
 *  unique index expenses_source_once_uniq guarantees at most one). */
const linkedExpense = async (
  operationId: number,
  sourceType: string,
  sourceId: number
): Promise<
  { id: number; expense_date: string; category: string; amount_cents: number; vendor: string | null; equipment_id: number | null }[]
> =>
  await db`
    SELECT id, to_char(expense_date, 'YYYY-MM-DD') AS expense_date, category, amount_cents, vendor, equipment_id
    FROM expenses
    WHERE operation_id = ${operationId} AND source_type = ${sourceType} AND source_id = ${sourceId}`;

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "equipmentExpenseLinking.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "The owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent — includes 0021_equipment_expense_linking.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Expense Linking Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Expense Linking Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;
  const [ea] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category) VALUES (${opAId}, 'A Service Truck', 'truck') RETURNING id`;
  const [eb] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category) VALUES (${opBId}, 'B Service Truck', 'truck') RETURNING id`;
  eqAId = ea.id;
  eqBId = eb.id;
  const [hay] = await db<[{ id: number }]>`
    INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit, low_stock_threshold)
    VALUES (${opAId}, 'grass', 80, 'bales', 10) RETURNING id`;
  hayId = hay.id;
  const [pasture] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres) VALUES (${opAId}, 'Linking Test Pasture', 120) RETURNING id`;
  pastureId = pasture.id;
});

afterAll(async () => {
  // Operations cascade-delete every scoped row (equipment → records, expenses,
  // restock_log, pasture_activities, hay_inventory, pastures).
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
// S1 — a repair with a cost reaches Expenses as exactly ONE linked row
// ---------------------------------------------------------------------------

describe("S1 — maintenance with cost ⇒ one linked repairs_maintenance expense", () => {
  test("a $487.25 repair writes the record AND the ONE ledger row with the right link", async () => {
    const res = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      service_date: "2026-10-20",
      service_type: "repair",
      description: "Hydraulic line replacement",
      cost_cents: 48725,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Bob's Shop",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    expect(res.expense_created).toBe(true);

    const linked = await linkedExpense(opAId, "maintenance", res.id);
    expect(linked.length).toBe(1);
    expect(linked[0].category).toBe("repairs_maintenance");
    expect(linked[0].amount_cents).toBe(48725);
    expect(linked[0].expense_date).toBe("2026-10-20");
    expect(linked[0].vendor).toBe("Bob's Shop");
    expect(linked[0].equipment_id).toBe(eqAId);
  });

  test("the record row itself carries the cost and the request id (0021 column)", async () => {
    const rows = await db<{ client_request_id: string; cost_cents: number }[]>`
      SELECT client_request_id, cost_cents FROM maintenance_records WHERE operation_id = ${opAId}`;
    expect(rows.length).toBe(1);
    expect(rows[0].cost_cents).toBe(48725);
    expect(rows[0].client_request_id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// S2 — a fuel fill with a cost reaches Expenses as exactly ONE linked row
// ---------------------------------------------------------------------------

describe("S2 — fuel with cost ⇒ one linked fuel expense", () => {
  test("an $89.05 fill writes the record AND the ONE ledger row with the right link", async () => {
    const res = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: "2026-10-20",
      fuel_type: "diesel",
      gallons: 24.6,
      cost_cents: 8905,
      location: "Main tank",
      notes: "Fall fill",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    expect(res.expense_created).toBe(true);

    const linked = await linkedExpense(opAId, "fuel_log", res.id);
    expect(linked.length).toBe(1);
    expect(linked[0].category).toBe("fuel");
    expect(linked[0].amount_cents).toBe(8905);
    expect(linked[0].expense_date).toBe("2026-10-20");
    expect(linked[0].equipment_id).toBe(eqAId);
  });
});

// ---------------------------------------------------------------------------
// S3/S4 — double-tap idempotency (per operation) + the DB race backstop
// ---------------------------------------------------------------------------

describe("S3/S4 — same client_request_id never duplicates a record or an expense", () => {
  test("a second submit with the same key returns duplicate:true and applies nothing", async () => {
    const key = crypto.randomUUID();
    const first = await logFuelCore(db, opAId, {
      client_request_id: key,
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 12.0,
      cost_cents: 4200,
      location: null,
      notes: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await logFuelCore(db, opAId, {
      client_request_id: key,
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 12.0,
      cost_cents: 4200,
      location: null,
      notes: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.expense_created).toBe(true);

    const fills = await db<[{ id: number }]>`
      SELECT id FROM fuel_log WHERE operation_id = ${opAId} AND client_request_id = ${key}`;
    expect(fills.length).toBe(1);
    const linked = await linkedExpense(opAId, "fuel_log", first.id);
    expect(linked.length).toBe(1);
    expect(linked[0].amount_cents).toBe(4200);
  });

  test("the same for a service record", async () => {
    const key = crypto.randomUUID();
    const first = await logMaintenanceCore(db, opAId, {
      client_request_id: key,
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "oil-change",
      description: null,
      cost_cents: 6500,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Bob's Shop",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await logMaintenanceCore(db, opAId, {
      client_request_id: key,
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "oil-change",
      description: null,
      cost_cents: 6500,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Bob's Shop",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    const records = await db<[{ id: number }]>`
      SELECT id FROM maintenance_records WHERE operation_id = ${opAId} AND client_request_id = ${key}`;
    expect(records.length).toBe(1);
    expect((await linkedExpense(opAId, "maintenance", first.id)).length).toBe(1);
  });

  test("the DB constraint backs the true race — a duplicate key INSERT is rejected", async () => {
    const key = crypto.randomUUID();
    const [row] = await db<[{ id: number }]>`
      INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, client_request_id)
      VALUES (${opAId}, ${eqAId}, ${today()}, 'other', ${key}) RETURNING id`;
    expect(row.id).toBeGreaterThan(0);
    let threw = false;
    try {
      await db`
        INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, client_request_id)
        VALUES (${opAId}, ${eqAId}, ${today()}, 'other', ${key})`;
    } catch (err) {
      threw = true;
      const code = (err as { code?: string }).code;
      expect(code).toBe("23505");
    }
    expect(threw).toBe(true);

    const fkey = crypto.randomUUID();
    await db`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, client_request_id)
      VALUES (${opAId}, ${eqAId}, ${today()}, 'diesel', 5, ${fkey})`;
    let fuelThrew = false;
    try {
      await db`
        INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, client_request_id)
        VALUES (${opAId}, ${eqAId}, ${today()}, 'diesel', 5, ${fkey})`;
    } catch (err) {
      fuelThrew = true;
      expect((err as { code?: string }).code).toBe("23505");
    }
    expect(fuelThrew).toBe(true);
  });

  test("the same key in ANOTHER operation is its own row (uniqueness is per operation, never global)", async () => {
    const key = crypto.randomUUID();
    const a = await logFuelCore(db, opAId, {
      client_request_id: key,
      create_expense: false,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 5,
      cost_cents: null,
      location: null,
      notes: null,
    });
    const b = await logFuelCore(db, opBId, {
      client_request_id: key,
      create_expense: false,
      equipment_id: eqBId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 5,
      cost_cents: null,
      location: null,
      notes: null,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// S5 — an edit updates the SAME expense row; a removed cost deletes it
// ---------------------------------------------------------------------------

describe("S5 — the linked expense follows the edited source record", () => {
  test("editing a repair's cost updates the SAME ledger row (id stable), category untouched", async () => {
    const created = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      service_date: "2026-10-01",
      service_type: "repair",
      description: "Tire patch",
      cost_cents: 6500,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Bob's Shop",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await linkedExpense(opAId, "maintenance", created.id);
    expect(before.length).toBe(1);

    const edit = await updateMaintenanceCore(db, opAId, {
      id: created.id,
      service_date: "2026-10-02",
      service_type: "repair",
      description: "Tire patch (two tires)",
      cost_cents: 9900,
      vendor: "Bob's Shop",
      meter_hours: null,
      meter_miles: null,
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.expense_linked).toBe(true);

    const after = await linkedExpense(opAId, "maintenance", created.id);
    expect(after.length).toBe(1);
    expect(after[0].id).toBe(before[0].id); // the SAME row — never a second one
    expect(after[0].amount_cents).toBe(9900);
    expect(after[0].expense_date).toBe("2026-10-02");
    expect(after[0].vendor).toBe("Bob's Shop");
    expect(after[0].category).toBe("repairs_maintenance"); // category untouched
  });

  test("blanking a repair's cost deletes the linked row; re-adding one inserts exactly one", async () => {
    const created = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "scheduled",
      description: "Grease job",
      cost_cents: 2500,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const withCost = await linkedExpense(opAId, "maintenance", created.id);
    expect(withCost.length).toBe(1);

    const cleared = await updateMaintenanceCore(db, opAId, {
      id: created.id,
      service_date: today(),
      service_type: "scheduled",
      description: "Grease job",
      cost_cents: null,
      vendor: null,
      meter_hours: null,
      meter_miles: null,
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.expense_linked).toBe(false);
    expect((await linkedExpense(opAId, "maintenance", created.id)).length).toBe(0);

    const reAdded = await updateMaintenanceCore(db, opAId, {
      id: created.id,
      service_date: today(),
      service_type: "scheduled",
      description: "Grease job",
      cost_cents: 3100,
      vendor: null,
      meter_hours: null,
      meter_miles: null,
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
    });
    expect(reAdded.ok).toBe(true);
    if (!reAdded.ok) return;
    expect(reAdded.expense_linked).toBe(true);
    const back = await linkedExpense(opAId, "maintenance", created.id);
    expect(back.length).toBe(1);
    expect(back[0].amount_cents).toBe(3100);
  });

  test("the same rules hold for a fuel fill", async () => {
    const created = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: "2026-10-03",
      fuel_type: "gasoline",
      gallons: 10,
      cost_cents: 3600,
      location: "Co-op",
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await linkedExpense(opAId, "fuel_log", created.id);
    expect(before.length).toBe(1);

    const edited = await updateFuelCore(db, opAId, {
      id: created.id,
      fuel_date: "2026-10-04",
      fuel_type: "gasoline",
      gallons: 11,
      cost_cents: 3960,
      location: "Co-op",
      notes: "price went up",
      meter_hours: null,
      meter_miles: null,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const after = await linkedExpense(opAId, "fuel_log", created.id);
    expect(after.length).toBe(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].amount_cents).toBe(3960);
    expect(after[0].expense_date).toBe("2026-10-04");
    expect(after[0].category).toBe("fuel");

    const cleared = await updateFuelCore(db, opAId, {
      id: created.id,
      fuel_date: "2026-10-04",
      fuel_type: "gasoline",
      gallons: 11,
      cost_cents: null,
      location: "Co-op",
      notes: null,
      meter_hours: null,
      meter_miles: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.expense_linked).toBe(false);
    expect((await linkedExpense(opAId, "fuel_log", created.id)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S6 — a void removes the linked expense AND the record together
// ---------------------------------------------------------------------------

describe("S6 — void removes both halves, nothing partial", () => {
  test("voiding a repair removes the record and its linked expense", async () => {
    const created = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "repair",
      description: "Belt",
      cost_cents: 12000,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Shop",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await linkedExpense(opAId, "maintenance", created.id)).length).toBe(1);

    const voided = await deleteMaintenanceCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.linked_expense_removed).toBe(true);
    expect((await linkedExpense(opAId, "maintenance", created.id)).length).toBe(0);
    const records = await db<[{ id: number }]>`
      SELECT id FROM maintenance_records WHERE id = ${created.id} AND operation_id = ${opAId}`;
    expect(records.length).toBe(0);
  });

  test("voiding a fuel fill removes the record and its linked expense", async () => {
    const created = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 20,
      cost_cents: 7200,
      location: null,
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const voided = await deleteFuelCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.linked_expense_removed).toBe(true);
    expect((await linkedExpense(opAId, "fuel_log", created.id)).length).toBe(0);
    const fills = await db<[{ id: number }]>`
      SELECT id FROM fuel_log WHERE id = ${created.id} AND operation_id = ${opAId}`;
    expect(fills.length).toBe(0);
  });

  test("voiding a record that never had an expense still voids cleanly (linked_expense_removed false)", async () => {
    const created = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: false,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 3,
      cost_cents: 1100,
      location: null,
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await linkedExpense(opAId, "fuel_log", created.id)).length).toBe(0);
    const voided = await deleteFuelCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.linked_expense_removed).toBe(false);
    const fills = await db<[{ id: number }]>`
      SELECT id FROM fuel_log WHERE id = ${created.id} AND operation_id = ${opAId}`;
    expect(fills.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S7 — no-cost paths never create an expense; one transaction; op scoping
// ---------------------------------------------------------------------------

describe("S7 — NULL/0 cost ⇒ NO expense, ever; the create_expense choice; atomicity", () => {
  test("a repair with a NULL cost writes the record only (no $0 ledger row)", async () => {
    const res = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "inspection",
      description: "Walk-around",
      cost_cents: null,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect((await linkedExpense(opAId, "maintenance", res.id)).length).toBe(0);
  });

  test("a $0 cost is treated the same as no cost (never a $0 ledger row)", async () => {
    const res = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 1,
      cost_cents: 0,
      location: null,
      notes: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    expect((await linkedExpense(opAId, "fuel_log", res.id)).length).toBe(0);
  });

  test("create_expense:false keeps the cost on the record but writes NO ledger row", async () => {
    const res = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: false,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 8,
      cost_cents: 2900,
      location: null,
      notes: "record only",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expense_created).toBe(false);
    const [row] = await db<[{ cost_cents: number }]>`
      SELECT cost_cents FROM fuel_log WHERE id = ${res.id}`;
    expect(row.cost_cents).toBe(2900);
    expect((await linkedExpense(opAId, "fuel_log", res.id)).length).toBe(0);
  });

  test("a forced expense failure rolls the record insert back — nothing partial", async () => {
    // Make ANY equipment-linked ledger insert fail on a CHECK constraint —
    // but ONLY for the sentinel row of this test (existing linked rows from
    // the tests above must keep validating, so the sentinel vendor is the
    // trigger). Same forced-failure shape as the restock suite's guarantee-1.
    await db`ALTER TABLE expenses ADD CONSTRAINT tmp_block_equipment_sources
      CHECK (source_type IS NULL OR source_type NOT IN ('maintenance', 'fuel_log')
             OR vendor IS DISTINCT FROM 'ROLLBACK-TEST-SENTINEL')`;
    let threw = false;
    try {
      await logMaintenanceCore(db, opAId, {
        client_request_id: crypto.randomUUID(),
        create_expense: true,
        equipment_id: eqAId,
        service_date: today(),
        service_type: "repair",
        description: "should never persist",
        cost_cents: 5000,
        meter_hours: null,
        meter_miles: null,
        status: "done",
        next_due_date: null,
        next_due_hours: null,
        next_due_miles: null,
        vendor: "ROLLBACK-TEST-SENTINEL",
      });
    } catch {
      threw = true;
    } finally {
      await db`ALTER TABLE expenses DROP CONSTRAINT IF EXISTS tmp_block_equipment_sources`;
    }
    expect(threw).toBe(true);
    const records = await db<[{ id: number }]>`
      SELECT id FROM maintenance_records WHERE operation_id = ${opAId} AND description = 'should never persist'`;
    expect(records.length).toBe(0);
    // And the constraint is really gone — a normal linked write succeeds again.
    const probe = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 1,
      cost_cents: 350,
      location: null,
      notes: "post-rollback probe",
    });
    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    expect(probe.expense_created).toBe(true);
  });

  test("cross-ranch writes and edits are refused (operation scoping preserved)", async () => {
    // Ranch B already owns legitimate rows from the per-operation key test
    // above — snapshot its counts and prove the cross-ranch attempts change
    // NOTHING on B's side.
    const bFuelBefore = await db<[{ n: number }]>`SELECT count(*)::int AS n FROM fuel_log WHERE operation_id = ${opBId}`;
    const bMaintBefore = await db<[{ n: number }]>`SELECT count(*)::int AS n FROM maintenance_records WHERE operation_id = ${opBId}`;
    const fuel = await logFuelCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqBId, // B's truck, A's session
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 5,
      cost_cents: 1800,
      location: null,
      notes: null,
    });
    expect(fuel.ok).toBe(false);
    if (!fuel.ok) expect(fuel.error).toContain("That equipment doesn't exist in this ranch.");
    const bFuel = await db<[{ n: number }]>`SELECT count(*)::int AS n FROM fuel_log WHERE operation_id = ${opBId}`;
    expect(bFuel[0].n).toBe(bFuelBefore[0].n);

    const maint = await logMaintenanceCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      create_expense: true,
      equipment_id: eqBId,
      service_date: today(),
      service_type: "repair",
      description: null,
      cost_cents: 100,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: null,
    });
    expect(maint.ok).toBe(false);
    const bMaint = await db<[{ n: number }]>`SELECT count(*)::int AS n FROM maintenance_records WHERE operation_id = ${opBId}`;
    expect(bMaint[0].n).toBe(bMaintBefore[0].n);

    // B owns a real record; A's edit/void by id must be invisible (refused).
    const bRecord = await logFuelCore(db, opBId, {
      client_request_id: crypto.randomUUID(),
      create_expense: false,
      equipment_id: eqBId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 2,
      cost_cents: 700,
      location: null,
      notes: null,
    });
    expect(bRecord.ok).toBe(true);
    if (!bRecord.ok) return;
    const aEdit = await updateFuelCore(db, opAId, {
      id: bRecord.id,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 99,
      cost_cents: null,
      location: null,
      notes: null,
      meter_hours: null,
      meter_miles: null,
    });
    expect(aEdit.ok).toBe(false);
    const aVoid = await deleteFuelCore(db, opAId, bRecord.id);
    expect(aVoid.ok).toBe(false);
    const stillThere = await db<[{ gallons: string }]>`
      SELECT gallons FROM fuel_log WHERE id = ${bRecord.id}`;
    expect(stillThere.length).toBe(1);
    expect(Number(stillThere[0].gallons)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Regression — restock + pasture linked-expense behavior is UNCHANGED
// ---------------------------------------------------------------------------

describe("regression — restock + pasture still behave exactly as on 0018-era code", () => {
  test("a hay restock with a cost still creates exactly one hay_feed/’restock’ expense, retries as a duplicate, edits the SAME row, and void removes it", async () => {
    const before = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
    const key = crypto.randomUUID();
    const created = await restockItemCore(db, opAId, {
      client_request_id: key,
      item_kind: "hay",
      item_id: hayId,
      quantity: 25,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 31250,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.expense_created).toBe(true);
    expect(created.duplicate).toBe(false);
    const afterCreate = await linkedExpense(opAId, "restock", created.id);
    expect(afterCreate.length).toBe(1);
    expect(afterCreate[0].category).toBe("hay_feed");
    expect(afterCreate[0].amount_cents).toBe(31250);
    const stock = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
    expect(Number(stock[0].quantity)).toBe(Number(before[0].quantity) + 25);

    // Same key retry: duplicate:true, no second row, no second expense, no extra stock.
    const retried = await restockItemCore(db, opAId, {
      client_request_id: key,
      item_kind: "hay",
      item_id: hayId,
      quantity: 25,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 31250,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.duplicate).toBe(true);
    expect(retried.id).toBe(created.id);
    expect((await linkedExpense(opAId, "restock", created.id)).length).toBe(1);
    const stockAfterRetry = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
    expect(Number(stockAfterRetry[0].quantity)).toBe(Number(before[0].quantity) + 25);

    const edited = await updateRestockCore(db, opAId, {
      id: created.id,
      quantity: 30,
      unit: "bales",
      restock_date: today(),
      total_cost_cents: 36000,
      vendor: "Triple C Hay",
      notes: null,
    });
    expect(edited.ok).toBe(true);
    const afterEdit = await linkedExpense(opAId, "restock", created.id);
    expect(afterEdit.length).toBe(1);
    expect(afterEdit[0].id).toBe(afterCreate[0].id);
    expect(afterEdit[0].amount_cents).toBe(36000);

    const voided = await deleteRestockCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.linked_expense_removed).toBe(true);
    expect((await linkedExpense(opAId, "restock", created.id)).length).toBe(0);
    // inventory restored exactly
    const finalStock = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${hayId}`;
    expect(Number(finalStock[0].quantity)).toBe(Number(before[0].quantity));
  });

  test("a pasture activity with a cost still creates exactly one land_pasture expense, edits the SAME row, and delete removes it", async () => {
    const created = await savePastureActivityCore(db, opAId, {
      client_request_id: crypto.randomUUID(),
      pasture_id: pastureId,
      activity_date: today(),
      activity_type: "fencing",
      cost_cents: 12000,
      notes: null,
      record_expense: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.expense_created).toBe(true);
    const afterCreate = await linkedExpense(opAId, "pasture_activity", created.id);
    expect(afterCreate.length).toBe(1);
    expect(afterCreate[0].category).toBe("land_pasture");
    expect(afterCreate[0].amount_cents).toBe(12000);

    const edited = await updatePastureActivityCore(db, opAId, {
      id: created.id,
      activity_date: today(),
      activity_type: "fencing",
      cost_cents: 15000,
      notes: null,
      record_expense: true,
    });
    expect(edited.ok).toBe(true);
    const afterEdit = await linkedExpense(opAId, "pasture_activity", created.id);
    expect(afterEdit.length).toBe(1);
    expect(afterEdit[0].id).toBe(afterCreate[0].id);
    expect(afterEdit[0].amount_cents).toBe(15000);

    const deleted = await deletePastureActivityCore(db, opAId, created.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.linked_expense_removed).toBe(true);
    expect((await linkedExpense(opAId, "pasture_activity", created.id)).length).toBe(0);
  });

  test("the shared registry maps every source to its category and jump route", async () => {
    const { EXPENSE_SOURCE_REGISTRY } = await import("~/server/expenseLink");
    expect(EXPENSE_SOURCE_REGISTRY.restock).toEqual({ category: "hay_feed", jump: "/feed" });
    expect(EXPENSE_SOURCE_REGISTRY.pasture_activity).toEqual({ category: "land_pasture", jump: "/pasture" });
    expect(EXPENSE_SOURCE_REGISTRY.maintenance).toEqual({ category: "repairs_maintenance", jump: "/equipment" });
    expect(EXPENSE_SOURCE_REGISTRY.fuel_log).toEqual({ category: "fuel", jump: "/equipment" });
  });
});

// ---------------------------------------------------------------------------
// D2 — the fuel de-dupe: the dashboard's fuel stat reads the LEDGER (one read
// per fill-up), with the honest fuel_log fallbacks.
// ---------------------------------------------------------------------------
describe("D2 — the dashboard fuel stat reads the ledger once (no double-count)", () => {
  test("a fill-up with its linked ledger row is counted ONCE — not fuel_log + ledger", async () => {
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Dedupe Ranch') RETURNING id`;
    const [eq] = await db<[{ id: number }]>`
      INSERT INTO equipment (operation_id, name, category) VALUES (${op.id}, 'Dedupe Truck', 'truck') RETURNING id`;
    try {
      const created = await logFuelCore(db, op.id, {
        client_request_id: `dedupe-${Date.now()}`,
        create_expense: true,
        equipment_id: eq.id,
        fuel_date: today(),
        fuel_type: "diesel",
        gallons: 12.5,
        cost_cents: 4899,
        location: "Dedupe tank",
        notes: null,
      });
      expect(created.ok).toBe(true);
      // Both halves exist: the fuel_log row AND exactly one ledger row.
      expect((await linkedExpense(op.id, "fuel_log", created.ok ? created.id : 0)).length).toBe(1);
      const summary = await fuelSummaryCore(db, op.id, { sourceType: true, sourceId: true });
      expect(summary).not.toBeNull();
      if (!summary) return;
      expect(summary.source).toBe("ledger");
      expect(summary.totalEntries).toBe(1);
      expect(summary.totalCents).toBe(4899); // NOT 9798 — the double-count this fix exists for
      expect(summary.gallons).toBe(12.5);
      const machine = summary.byEquipment.find((r) => r.equipment_name === "Dedupe Truck");
      expect(machine).toBeDefined();
      if (!machine) return;
      expect(machine.cost_cents).toBe(4899);
      expect(machine.gallons).toBe(12.5);
    } finally {
      await db`DELETE FROM operations WHERE id = ${op.id}`;
    }
  });

  test("no linked ledger rows (legacy fill-ups) → falls back to fuel_log", async () => {
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Legacy Fuel Ranch') RETURNING id`;
    try {
      await db`
        INSERT INTO fuel_log (operation_id, fuel_date, fuel_type, gallons, cost_cents, client_request_id)
        VALUES (${op.id}, ${today()}, 'diesel', 8, 2500, 'legacy-fill-no-ledger')`;
      const summary = await fuelSummaryCore(db, op.id, { sourceType: true, sourceId: true });
      expect(summary).not.toBeNull();
      if (!summary) return;
      expect(summary.source).toBe("fuel_log");
      expect(summary.totalEntries).toBe(1);
      expect(summary.totalCents).toBe(2500);
      expect(summary.gallons).toBe(8);
    } finally {
      await db`DELETE FROM operations WHERE id = ${op.id}`;
    }
  });

  test("link columns absent (0018 unapplied) → the fuel_log fallback keeps working", async () => {
    const [op] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('No Link Cols Ranch') RETURNING id`;
    try {
      await db`
        INSERT INTO fuel_log (operation_id, fuel_date, fuel_type, gallons, cost_cents, client_request_id)
        VALUES (${op.id}, ${today()}, 'diesel', 10, 3140, 'legacy-fill-no-cols')`;
      const summary = await fuelSummaryCore(db, op.id, { sourceType: false, sourceId: false });
      expect(summary).not.toBeNull();
      if (!summary) return;
      expect(summary.source).toBe("fuel_log");
      expect(summary.totalCents).toBe(3140);
      expect(summary.totalEntries).toBe(1);
    } finally {
      await db`DELETE FROM operations WHERE id = ${op.id}`;
    }
  });

  test("the loader's link join reports the linked ledger row on the maintenance record", async () => {
    const created = await logMaintenanceCore(db, opAId, {
      client_request_id: `join-check-${Date.now()}`,
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "repair",
      description: "Join check",
      cost_cents: 775,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await db<[{ id: number; expense_id: number | null }]>`
      SELECT m.id, xm.id AS expense_id
      FROM maintenance_records m
      LEFT JOIN expenses xm ON xm.source_type = 'maintenance' AND xm.source_id = m.id
      WHERE m.id = ${created.id} AND m.operation_id = ${opAId}`;
    expect(joined.length).toBe(1);
    expect(joined[0].expense_id).not.toBeNull();
    const voided = await deleteMaintenanceCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Expenses-side guards name WHERE the source record lives (part 2 item 3).
// ---------------------------------------------------------------------------
describe("linked-expense refusals name where the record is corrected", () => {
  test("a linked repair expense can only be edited through its equipment row", async () => {
    const created = await logMaintenanceCore(db, opAId, {
      client_request_id: `refusal-maint-${Date.now()}`,
      create_expense: true,
      equipment_id: eqAId,
      service_date: today(),
      service_type: "repair",
      description: "Refusal test",
      cost_cents: 12300,
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: "Shop",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const linked = await linkedExpense(opAId, "maintenance", created.id);
    expect(linked.length).toBe(1);
    const sneakyEdit: ExpenseInput = {
      id: linked[0].id,
      expense_date: today(),
      category: "repairs_maintenance",
      amount_cents: 99999,
      vendor: "Sneaky",
      paid_by: null,
      herd_group_id: null,
      pasture_id: null,
      equipment_id: null,
      job: null,
      notes: null,
    };
    const badEdit = await saveExpenseCore(db, opAId, sneakyEdit);
    expect(badEdit.ok).toBe(false);
    if (!badEdit.ok) expect(badEdit.error).toContain("Equipment page's Service & maintenance");
    const badDelete = await deleteExpenseCore(db, opAId, linked[0].id);
    expect(badDelete.ok).toBe(false);
    if (!badDelete.ok) expect(badDelete.error).toContain("void that service record on the Equipment page");
    const voided = await deleteMaintenanceCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
  });

  test("a linked fuel expense can only be voided through its fill-up row", async () => {
    const created = await logFuelCore(db, opAId, {
      client_request_id: `refusal-fuel-${Date.now()}`,
      create_expense: true,
      equipment_id: eqAId,
      fuel_date: today(),
      fuel_type: "diesel",
      gallons: 5,
      cost_cents: 1999,
      location: null,
      notes: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const linked = await linkedExpense(opAId, "fuel_log", created.id);
    expect(linked.length).toBe(1);
    const badEdit = await saveExpenseCore(db, opAId, {
      id: linked[0].id,
      expense_date: today(),
      category: "fuel",
      amount_cents: 1,
      vendor: "Sneaky",
      paid_by: null,
      herd_group_id: null,
      pasture_id: null,
      equipment_id: null,
      job: null,
      notes: null,
    });
    expect(badEdit.ok).toBe(false);
    if (!badEdit.ok) expect(badEdit.error).toContain("Equipment page's Fuel usage");
    const badDelete = await deleteExpenseCore(db, opAId, linked[0].id);
    expect(badDelete.ok).toBe(false);
    if (!badDelete.ok) expect(badDelete.error).toContain("void that fill-up on the Equipment page");
    const voided = await deleteFuelCore(db, opAId, created.id);
    expect(voided.ok).toBe(true);
  });

  test("the restock/pasture refusals keep their original Phase-1 wording", () => {
    expect(linkedExpenseEditRefusal("restock")).toContain("edit it from that record instead");
    expect(linkedExpenseEditRefusal("pasture_activity")).toContain("edit it from that record instead");
    expect(linkedExpenseDeleteRefusal("restock")).toContain("undo that record");
    expect(linkedExpenseDeleteRefusal("pasture_activity")).toContain("undo that record");
  });
});
