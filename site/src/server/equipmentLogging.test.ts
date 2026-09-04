// ============================================================================
// Ranch Manager Pro — Equipment fuel/service logging integration tests (bun test)
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
//     bun test src/server/equipmentLogging.test.ts
//
// Follows the tasks.test.ts / auth.test.ts pattern: exercises the EXACT INSERT
// shapes the logFuel / logMaintenance server fns run against a REAL local
// Postgres, operation-scoped via INSERT…SELECT…WHERE e.id AND
// e.operation_id = auth.operationId, plus pure client-logic unit tests
// (fuelTotalCents, draft-includes helpers).
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import { fuelTotalCents } from "~/types/equipment";
import { fuelDraftIncludes, serviceDraftIncludes } from "~/components/equipment/TrackingModals";

type TestDb = ReturnType<typeof sql>;

let db: TestDb;
let opAId: number;
let opBId: number;
let eqAId: number; // Ranch A's truck
let eqBId: number; // Ranch B's truck (must be invisible to A's writes)

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "equipmentLogging.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0004_equipment.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Equipment Test Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Equipment Test Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;

  // One unit per ranch — the cross-ranch target the isolation asserts on.
  const [ea] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category, hours, miles)
    VALUES (${opAId}, 'A Work Truck', 'truck', 1200, 86000) RETURNING id`;
  const [eb] = await db<[{ id: number }]>`
    INSERT INTO equipment (operation_id, name, category, hours, miles)
    VALUES (${opBId}, 'B Work Truck', 'truck', 500, 30000) RETURNING id`;
  eqAId = ea.id;
  eqBId = eb.id;
});

afterAll(async () => {
  // Operations cascade-delete every scoped row (equipment → fuel_log +
  // maintenance_records via ON DELETE). Idempotent if a test failed midway.
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
// Fuel logging — the exact logFuel INSERT shape, operation-scoped
// ---------------------------------------------------------------------------

describe("logFuel-shaped INSERT — operation-scoped writes", () => {
  test("accepts a valid equipment_id from the same ranch and persists the fill", async () => {
    const [row] = await db<[{ id: number }]>`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents, location, notes)
      SELECT ${opAId}, ${eqAId}, '2026-09-04', 'diesel', 48.5, 18371, 'Main tank', 'fall fill'
      WHERE ${eqAId}::int IS NULL
         OR EXISTS (SELECT 1 FROM equipment e WHERE e.id = ${eqAId}::int AND e.operation_id = ${opAId})
      RETURNING id`;
    expect(row.id).not.toBe(0);

    // The persisted row carries the operation + equipment.
    const [f] = await db<[{ id: number; operation_id: number; gallons: string; cost_cents: number }]>`
      SELECT id, operation_id, gallons, cost_cents FROM fuel_log WHERE id = ${row.id}`;
    expect(Number(f.operation_id)).toBe(opAId);
    expect(Number(f.gallons)).toBe(48.5);
    expect(f.cost_cents).toBe(18371);
  });

  test("allows a NULL equipment_id (bulk tank top-up)", async () => {
    const [row] = await db<[{ id: number }]>`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents)
      SELECT ${opAId}, NULL, '2026-09-04', 'diesel', 250, 90000
      WHERE NULL::int IS NULL
         OR EXISTS (SELECT 1 FROM equipment e WHERE e.id = NULL::int AND e.operation_id = ${opAId})
      RETURNING id`;
    expect(row.id).not.toBe(0);
    const [f] = await db<[{ equipment_id: number | null }]>`
      SELECT equipment_id FROM fuel_log WHERE id = ${row.id}`;
    expect(f.equipment_id).toBeNull();
  });

  test("REJECTS a cross-ranch equipment_id — the INSERT…SELECT matches zero rows (A cannot log fuel on B's truck)", async () => {
    // This is exactly what logFuel's handler runs: the WHERE clause is scoped
    // to A's operation, so B's truck id matches nothing and no row is created.
    const rows = await db<[{ id: number }]>`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents)
      SELECT ${opAId}, ${eqBId}, '2026-09-04', 'diesel', 10, 4000
      WHERE ${eqBId}::int IS NULL
         OR EXISTS (SELECT 1 FROM equipment e WHERE e.id = ${eqBId}::int AND e.operation_id = ${opAId})
      RETURNING id`;
    expect(rows.length).toBe(0);
  });

  test("the operation-scoped read can see A's fills but never B's", async () => {
    const aFuel = await db`SELECT id FROM fuel_log WHERE operation_id = ${opAId}`;
    const bFuel = await db`SELECT id FROM fuel_log WHERE operation_id = ${opBId}`;
    expect(aFuel.length).not.toBe(0); // the two A fills above
    expect(bFuel.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Maintenance logging — the exact logMaintenance INSERT shape
// ---------------------------------------------------------------------------

describe("logMaintenance-shaped INSERT — operation-scoped writes", () => {
  test("accepts a valid equipment_id from the same ranch and persists the service", async () => {
    const [row] = await db<[{ id: number }]>`
      INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, description,
                                       cost_cents, meter_hours, meter_miles, status, next_due_date,
                                       next_due_hours, next_due_miles, vendor)
      SELECT ${opAId}, ${eqAId}, '2026-09-04', 'oil-change', 'Oil + filter',
             6500, 1200, 86000, 'done', '2026-12-04',
             1300, NULL, ${"Bob's Shop"}
      FROM equipment e
      WHERE e.id = ${eqAId} AND e.operation_id = ${opAId}
      RETURNING id`;
    expect(row.id).not.toBe(0);

    const [m] = await db<[{ id: number; operation_id: number; service_type: string; vendor: string }]>`
      SELECT id, operation_id, service_type, vendor FROM maintenance_records WHERE id = ${row.id}`;
    expect(Number(m.operation_id)).toBe(opAId);
    expect(m.service_type).toBe("oil-change");
    expect(m.vendor).toBe("Bob's Shop");
  });

  test("REJECTS a cross-ranch equipment_id — INSERT…SELECT matches nothing (A cannot record service on B's truck)", async () => {
    const rows = await db<[{ id: number }]>`
      INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, cost_cents, status)
      SELECT ${opAId}, ${eqBId}, '2026-09-04', 'repair', 99900, 'done'
      FROM equipment e
      WHERE e.id = ${eqBId} AND e.operation_id = ${opAId}
      RETURNING id`;
    expect(rows.length).toBe(0);

    // Positive control: B's truck is real and reachable under B's operation.
    const [bCheck] = await db<[{ id: number }]>`
      SELECT id FROM equipment WHERE id = ${eqBId} AND operation_id = ${opBId}`;
    expect(bCheck.id).toBe(eqBId);
  });

  test("the operation-scoped read sees A's record and never B's", async () => {
    const aMaint = await db`SELECT id FROM maintenance_records WHERE operation_id = ${opAId}`;
    const bMaint = await db`SELECT id FROM maintenance_records WHERE operation_id = ${opBId}`;
    expect(aMaint.length).not.toBe(0);
    expect(bMaint.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Required-field validation (the parse helpers the server fns use)
// ---------------------------------------------------------------------------

describe("logFuel / logMaintenance validation rules", () => {
  test("fuel gallons must be > 0 and a finite number (validator rejects zero/blank/negative)", () => {
    // Mirror of the server's `posNum`: a non-finite or <= 0 value throws.
    const parseGallons = (v: unknown): number => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Gallons must be greater than zero.");
      return n;
    };
    expect(parseGallons(48.5)).toBe(48.5);
    expect(() => parseGallons(0)).toThrow("greater than zero");
    expect(() => parseGallons(-3)).toThrow("greater than zero");
    expect(() => parseGallons("")).toThrow("greater than zero");
  });

  test("service requires an equipment pick (validator throws without equipment_id)", () => {
    const pick = (v: unknown): number => {
      const n = v == null || v === "" ? null : Number(v);
      if (n === null) throw new Error("Pick the equipment this service is for.");
      return n;
    };
    expect(pick(7)).toBe(7);
    expect(() => pick(null)).toThrow("Pick the equipment");
    expect(() => pick("")).toThrow("Pick the equipment");
  });

  test("cost cents are clamped at zero, never negative (validator shape)", () => {
    // Server shape: dollars string → cents (×100), non-finite → null, negative → 0.
    const clampCost = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v) * 100;
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.round(n));
    };
    expect(clampCost("185.00")).toBe(18500);
    expect(clampCost(-0.5)).toBe(0);
    expect(clampCost("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure client logic — total-cost calc + draft-includes helpers
// ---------------------------------------------------------------------------

describe("fuelTotalCents — gallons × price per gallon (auto-computed total)", () => {
  test("computes the total in cents", () => {
    expect(fuelTotalCents(48.5, 3.79)).toBe(18382); // 48.5 × 3.79 = 183.815 → 18382
  });

  test("is 0 for a zero gallon or zero price entry", () => {
    expect(fuelTotalCents(0, 3.79)).toBe(0);
    expect(fuelTotalCents(20, 0)).toBe(0);
  });

  test("never returns negative — clamps at 0", () => {
    expect(fuelTotalCents(-5, 3)).toBe(0);
    expect(fuelTotalCents(5, -1)).toBe(0);
  });

  test("returns NaN for half-typed / blank inputs so the UI shows '—'", () => {
    expect(Number.isNaN(fuelTotalCents(Number.NaN, 3))).toBe(true);
    expect(Number.isNaN(fuelTotalCents(0, Number.NaN))).toBe(true);
    expect(Number.isNaN(fuelTotalCents(Number.POSITIVE_INFINITY, 3))).toBe(true);
  });
});

describe("tracking-form draft helpers (draft-includes)", () => {
  test("an untouched fuel draft does not count as a draft", () => {
    expect(
      fuelDraftIncludes({
        equipment_id: null,
        fuel_date: new Date().toISOString().slice(0, 10),
        gallons: "",
        pricePerGal: "",
        fuel_type: "diesel",
        meter_hours: "",
        meter_miles: "",
        location: "",
        notes: "",
      })
    ).toBe(false);
  });

  test("typing gallons, price, location, or notes marks the draft", () => {
    const base = {
      equipment_id: null,
      fuel_date: new Date().toISOString().slice(0, 10),
      gallons: "",
      pricePerGal: "",
      fuel_type: "diesel",
      meter_hours: "",
      meter_miles: "",
      location: "",
      notes: "",
    };
    expect(fuelDraftIncludes({ ...base, gallons: "48.5" })).toBe(true);
    expect(fuelDraftIncludes({ ...base, pricePerGal: "3.79" })).toBe(true);
    expect(fuelDraftIncludes({ ...base, location: "Main tank" })).toBe(true);
    expect(fuelDraftIncludes({ ...base, notes: "winter blend" })).toBe(true);
  });

  test("an untouched service draft does not count as a draft", () => {
    expect(
      serviceDraftIncludes({
        equipment_id: null,
        service_date: new Date().toISOString().slice(0, 10),
        service_type: "scheduled",
        cost: "",
        vendor: "",
        next_due_miles: "",
        next_due_hours: "",
        next_due_date: "",
        description: "",
      })
    ).toBe(false);
  });

  test("typing cost, vendor, next-due, or description marks the draft", () => {
    const base = {
      equipment_id: null,
      service_date: new Date().toISOString().slice(0, 10),
      service_type: "scheduled",
      cost: "",
      vendor: "",
      next_due_miles: "",
      next_due_hours: "",
      next_due_date: "",
      description: "",
    };
    expect(serviceDraftIncludes({ ...base, cost: "185" })).toBe(true);
    expect(serviceDraftIncludes({ ...base, vendor: "Bob's" })).toBe(true);
    expect(serviceDraftIncludes({ ...base, next_due_miles: "5000" })).toBe(true);
    expect(serviceDraftIncludes({ ...base, next_due_hours: "250" })).toBe(true);
    expect(serviceDraftIncludes({ ...base, next_due_date: "2026-12-04" })).toBe(true);
    expect(serviceDraftIncludes({ ...base, description: "oil change" })).toBe(true);
  });
});