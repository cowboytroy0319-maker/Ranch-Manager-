// ============================================================================
// Ranch Manager Pro — Tasks & Projects integration + pure-logic tests (bun test)
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
//     bun test src/server/tasks.test.ts
//
// Covers — against a REAL local Postgres, exactly like auth.test.ts —
//   • task creation / update / complete / reopen (the same SQL shapes the
//     server fns run, scoped by operation_id)
//   • operation isolation: Ranch A cannot read, edit, complete, or delete
//     Ranch B's tasks, hay, pasture, or equipment
//   • end-to-end persisted writes for the saveHay / savePasture / saveEquipment
//     shapes (insert → assert row → re-fetch scoped by operation shows it)
//   • pure selectDashboardTasks / dueBucket / dashboardCounts unit tests
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file. Migrations 0013–0015 give every
// operational table an operation_id so isolation is testable.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  dashboardCounts,
  dueBucket,
  parseProjectInput,
  parseTaskInput,
  selectDashboardTasks,
  todayStr,
} from "./tasks";
import type { DashboardTask, Task } from "~/types/tasks";

type TestDb = ReturnType<typeof sql>;

type SrcTask = Pick<Task, "id" | "title" | "status" | "priority" | "due_date" | "category" | "project_id">;

let db: TestDb;
let opAId: number;
let opBId: number;

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "tasks.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0015_tasks_projects.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Tasks Test Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Tasks Test Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;
});

afterAll(async () => {
  // Operations cascade-delete every scoped row (tasks, projects, hay, pastures,
  // equipment, memberships…). Idempotent if a test failed midway.
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
// Validation helpers
// ---------------------------------------------------------------------------

describe("parseTaskInput — title required, enums defaulted, dates validated", () => {
  test("throws when title is missing / blank / too long", () => {
    expect(() => parseTaskInput({})).toThrow("Task title is required.");
    expect(() => parseTaskInput({ title: "   " })).toThrow("Task title is required.");
    expect(() => parseTaskInput({ title: "x".repeat(301) })).toThrow("Task title is too long");
  });

  test("defaults status/priority/category and nulls optional fields", () => {
    const out = parseTaskInput({ title: "Pull calves" });
    expect(out.status).toBe("to_do");
    expect(out.priority).toBe("normal");
    expect(out.category).toBe("general");
    expect(out.due_date).toBeNull();
    expect(out.project_id).toBeNull();
    expect(out.pasture_id).toBeNull();
    expect(out.equipment_id).toBeNull();
    expect(out.animal_id).toBeNull();
  });

  test("parses a valid due date and rejects malformed ones", () => {
    expect(parseTaskInput({ title: "T", due_date: "2026-08-31" }).due_date).toBe("2026-08-31");
    expect(() => parseTaskInput({ title: "T", due_date: "31/08/2026" })).toThrow("YYYY-MM-DD");
    expect(() => parseTaskInput({ title: "T", due_date: "not-a-date" })).toThrow("YYYY-MM-DD");
  });

  test("keeps allowed enum values, coerces unlisted ones to defaults", () => {
    const out = parseTaskInput({ title: "T", status: "in_progress", priority: "urgent", category: "fencing/water" });
    expect(out.status).toBe("in_progress");
    expect(out.priority).toBe("urgent");
    expect(out.category).toBe("fencing/water");
    const coerced = parseTaskInput({ title: "T", status: "bogus", priority: "bogus", category: "bogus" });
    expect(coerced.status).toBe("to_do");
    expect(coerced.priority).toBe("normal");
    expect(coerced.category).toBe("general");
  });
});

describe("parseProjectInput — name required and length-limited", () => {
  test("throws on missing or blank name", () => {
    expect(() => parseProjectInput({})).toThrow("Project name is required.");
    expect(() => parseProjectInput({ name: "  " })).toThrow("Project name is required.");
  });

  test("throws on over-long name, accepts optional description", () => {
    expect(() => parseProjectInput({ name: "x".repeat(201) })).toThrow("Project name is too long");
    const out = parseProjectInput({ name: "2026 Fence Build", description: "North paddocks" });
    expect(out.name).toBe("2026 Fence Build");
    expect(out.description).toBe("North paddocks");
    expect(parseProjectInput({ name: "Solo" }).description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure dashboard selection
// ---------------------------------------------------------------------------

describe("dueBucket — relative-day bucketing (pure)", () => {
  test("overdue when due before today, today on the same day", () => {
    expect(dueBucket("2026-09-01", "2026-09-03")).toBe("overdue");
    expect(dueBucket("2026-09-03", "2026-09-03")).toBe("today");
  });

  test("null and future dates are not bucketed", () => {
    expect(dueBucket(null, "2026-09-03")).toBeNull();
    expect(dueBucket("2026-09-10", "2026-09-03")).toBeNull();
  });
});

describe("selectDashboardTasks — overdue / due-today / high-priority OPEN tasks", () => {
  const today = "2026-09-03";
  const mk = (id: number, partial: Partial<SrcTask> = {}): SrcTask => ({
    id,
    title: `Task ${id}`,
    status: "to_do",
    priority: "normal",
    due_date: null,
    category: "general",
    project_id: null,
    ...partial,
  });

  test("excludes completed and canceled tasks even when overdue", () => {
    const tasks = [
      mk(1, { status: "completed", due_date: "2026-08-01" }),
      mk(2, { status: "canceled", priority: "urgent" }),
      mk(3, { status: "in_progress", due_date: "2026-08-01" }),
    ];
    const out = selectDashboardTasks(tasks, today);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe(3);
    expect(out[0].reason).toBe("overdue");
  });

  test("selects overdue, due-today, and urgent/high with the right reason", () => {
    const tasks = [
      mk(1, { due_date: "2026-09-01" }), // overdue
      mk(2, { due_date: "2026-09-03" }), // today
      mk(3, { priority: "urgent" }), // high priority (no due)
      mk(4, { priority: "high", due_date: "2026-09-10" }), // high priority (future due)
      mk(5, { due_date: "2026-09-10" }), // future + normal → not selected
    ];
    const out = selectDashboardTasks(tasks, today);
    expect(out.map((t) => t.id).sort()).toEqual([1, 2, 3, 4]);
    const byId = new Map(out.map((t) => [t.id, t]));
    expect(byId.get(1)?.reason).toBe("overdue");
    expect(byId.get(2)?.reason).toBe("today");
    expect(byId.get(3)?.reason).toBe("high priority");
    expect(byId.get(4)?.reason).toBe("high priority");
  });

  test("sorts most urgent first: overdue → today → high priority, then priority, then due date", () => {
    const tasks = [
      mk(1, { priority: "low", due_date: "2026-09-01" }), // overdue, low
      mk(2, { priority: "urgent", due_date: "2026-09-10" }), // high priority, urgent
      mk(3, { due_date: "2026-09-03" }), // today
      mk(4, { priority: "urgent", due_date: "2026-08-20" }), // overdue, urgent
      mk(5, { priority: "high" }), // high priority, high
    ];
    const out = selectDashboardTasks(tasks, today);
    expect(out.map((t) => t.id)).toEqual([4, 1, 3, 2, 5]);
  });

  test("attaches project_name from the lookup map", () => {
    // High priority so both rows are selected (no due date, normal priority
    // rows are correctly excluded by the selection rule).
    const tasks = [mk(1, { project_id: 7, priority: "high" }), mk(2, { project_id: 99, priority: "urgent" })];
    const names = new Map<number, string>([[7, "Fence Build"]]);
    const out = selectDashboardTasks(tasks, today, names);
    expect(out.length).toBe(2);
    expect(out.find((t) => t.id === 1)?.project_name).toBe("Fence Build");
    expect(out.find((t) => t.id === 2)?.project_name).toBeNull();
  });
});

describe("dashboardCounts — tally by reason (pure)", () => {
  test("counts each bucket", () => {
    const base = { status: "to_do" as const, category: "general" as const };
    const tasks: DashboardTask[] = [
      { id: 1, title: "a", due_date: "2026-08-01", project_name: null, reason: "overdue", priority: "normal", ...base },
      { id: 2, title: "b", due_date: "2026-09-03", project_name: null, reason: "today", priority: "normal", ...base },
      { id: 3, title: "c", due_date: null, priority: "urgent", project_name: null, reason: "high priority", ...base },
      { id: 4, title: "d", due_date: null, priority: "high", project_name: null, reason: "high priority", ...base },
    ];
    expect(dashboardCounts(tasks)).toEqual({ overdue: 1, dueToday: 1, high: 2 });
  });

  test("empty list counts zero", () => {
    expect(dashboardCounts([])).toEqual({ overdue: 0, dueToday: 0, high: 0 });
  });

  test("todayStr returns YYYY-MM-DD", () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Task lifecycle persisted against the local DB (same SQL shapes as the
// server fns — saveTask/updateTask/completeTask/reopenTask)
// ---------------------------------------------------------------------------

/** The exact INSERT shape saveTask runs, minus requireAuth (we pass the op). */
async function insertTask(
  db: TestDb,
  opId: number,
  title: string,
  opts: {
    description?: string | null;
    status?: Task["status"];
    priority?: Task["priority"];
    due_date?: string | null;
    category?: Task["category"];
  } = {}
): Promise<number> {
  const row = await db<[{ id: number }]>`
    INSERT INTO tasks (operation_id, title, description, status, priority, due_date, category,
                       project_id, pasture_id, equipment_id, animal_id)
    VALUES (${opId}, ${title}, ${opts.description ?? null}, ${opts.status ?? "to_do"},
            ${opts.priority ?? "normal"}, ${opts.due_date ?? null}, ${opts.category ?? "general"},
            NULL, NULL, NULL, NULL)
    RETURNING id`;
  return row[0].id;
}

describe("task lifecycle (local DB, operation-scoped)", () => {
  test("create → row exists with defaults, visible to a read scoped to the operation", async () => {
    const id = await insertTask(db, opAId, "Tag replacement heifers", { due_date: "2026-09-10", priority: "high" });
    const rows = await db<[{ id: number; title: string; status: string; priority: string; due_date: string | null }]>`
      SELECT id, title, status, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date
      FROM tasks WHERE id = ${id} AND operation_id = ${opAId}`;
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Tag replacement heifers");
    expect(rows[0].status).toBe("to_do");
    expect(rows[0].priority).toBe("high");
    expect(rows[0].due_date).toBe("2026-09-10");

    // A read scoped to the OTHER operation cannot see it (isolation positive check).
    const other = await db`SELECT id FROM tasks WHERE id = ${id} AND operation_id = ${opBId}`;
    expect(other.length).toBe(0);
  });

  test("update (same shape as updateTask) changes fields and hits only this row", async () => {
    const id = await insertTask(db, opAId, "Fix east fence");
    const updated = await db`
      UPDATE tasks SET title='Fix west fence', description='Wire + posts', status='in_progress',
        priority='urgent', due_date='2026-09-01', category='fencing/water',
        project_id=NULL, pasture_id=NULL, equipment_id=NULL, animal_id=NULL, updated_at=now()
      WHERE id=${id} AND operation_id=${opAId} RETURNING id`;
    expect(updated.length).toBe(1);
    const [row] = await db<[{ title: string; status: string; priority: string; category: string }]>`
      SELECT title, status, priority, category FROM tasks WHERE id = ${id}`;
    expect(row.title).toBe("Fix west fence");
    expect(row.status).toBe("in_progress");
    expect(row.priority).toBe("urgent");
    expect(row.category).toBe("fencing/water");
  });

  test("complete then reopen round-trips (status to_do → completed → to_do)", async () => {
    const id = await insertTask(db, opAId, "Oil change on F-350");
    const done = await db`
      UPDATE tasks SET status='completed', updated_at=now()
      WHERE id=${id} AND operation_id=${opAId} RETURNING id`;
    expect(done.length).toBe(1);
    const [c1] = await db<[{ status: string }]>`SELECT status FROM tasks WHERE id = ${id}`;
    expect(c1.status).toBe("completed");

    const reopened = await db`
      UPDATE tasks SET status='to_do', updated_at=now()
      WHERE id=${id} AND operation_id=${opAId} RETURNING id`;
    expect(reopened.length).toBe(1);
    const [c2] = await db<[{ status: string }]>`SELECT status FROM tasks WHERE id = ${id}`;
    expect(c2.status).toBe("to_do");
  });
});

// ---------------------------------------------------------------------------
// Operation isolation — Ranch A cannot read/edit/complete/delete Ranch B's
// tasks, hay, pasture, or equipment
// ---------------------------------------------------------------------------

describe("operation isolation — cross-ranch reads/writes are rejected", () => {
  let bTaskId: number;
  let bHayId: number;
  let bPastureId: number;
  let bEquipId: number;

  test("seed Ranch B data (task, hay, pasture, equipment) scoped to opB", async () => {
    bTaskId = await insertTask(db, opBId, "B-Ranch chore", { due_date: "2026-09-01" });
    const [hay] = await db<[{ id: number }]>`
      INSERT INTO hay_inventory (operation_id, feed_type, quantity, unit)
      VALUES (${opBId}, 'grass', 5, 'bales') RETURNING id`;
    bHayId = hay.id;
    const [pasture] = await db<[{ id: number }]>`
      INSERT INTO pastures (operation_id, name, size_acres, status)
      VALUES (${opBId}, 'B-South Pasture', 120, 'resting') RETURNING id`;
    bPastureId = pasture.id;
    const [equip] = await db<[{ id: number }]>`
      INSERT INTO equipment (operation_id, name, category, status)
      VALUES (${opBId}, 'B-Old Tractor', 'tractor', 'in-service') RETURNING id`;
    bEquipId = equip.id;
  });

  test("a read scoped to Ranch A sees none of Ranch B's rows (positive control: B sees them)", async () => {
    const aTasks = await db`SELECT id FROM tasks WHERE operation_id = ${opAId}`;
    expect(aTasks.some((r) => r.id === bTaskId)).toBe(false);
    const aHay = await db`SELECT id FROM hay_inventory WHERE operation_id = ${opAId}`;
    expect(aHay.some((r) => r.id === bHayId)).toBe(false);
    const aPastures = await db`SELECT id FROM pastures WHERE operation_id = ${opAId}`;
    expect(aPastures.some((r) => r.id === bPastureId)).toBe(false);
    const aEquip = await db`SELECT id FROM equipment WHERE operation_id = ${opAId}`;
    expect(aEquip.some((r) => r.id === bEquipId)).toBe(false);

    // Positive control: scoped to B, each row IS visible.
    expect((await db`SELECT id FROM tasks WHERE operation_id = ${opBId}`).some((r) => r.id === bTaskId)).toBe(true);
    expect((await db`SELECT id FROM hay_inventory WHERE operation_id = ${opBId}`).length).toBe(1);
    expect((await db`SELECT id FROM pastures WHERE operation_id = ${opBId}`).length).toBe(1);
    expect((await db`SELECT id FROM equipment WHERE operation_id = ${opBId}`).length).toBe(1);
  });

  test("an UPDATE/edit scoped to Ranch A cannot mutate Ranch B's task, hay, pasture, or equipment", async () => {
    const taskUpd = await db`
      UPDATE tasks SET title='A hijacks B', updated_at=now()
      WHERE id=${bTaskId} AND operation_id=${opAId} RETURNING id`;
    expect(taskUpd.length).toBe(0);
    const hayUpd = await db`
      UPDATE hay_inventory SET quantity=999, updated_at=now()
      WHERE id=${bHayId} AND operation_id=${opAId} RETURNING id`;
    expect(hayUpd.length).toBe(0);
    const pastureUpd = await db`
      UPDATE pastures SET name='A hijacks B', updated_at=now()
      WHERE id=${bPastureId} AND operation_id=${opAId} RETURNING id`;
    expect(pastureUpd.length).toBe(0);
    const equipUpd = await db`
      UPDATE equipment SET status='out-of-service', updated_at=now()
      WHERE id=${bEquipId} AND operation_id=${opAId} RETURNING id`;
    expect(equipUpd.length).toBe(0);

    // Nothing actually changed (B's rows untouched).
    const [t] = await db<[{ title: string }]>`SELECT title FROM tasks WHERE id = ${bTaskId}`;
    expect(t.title).toBe("B-Ranch chore");
    const [h] = await db<[{ quantity: string }]>`SELECT quantity FROM hay_inventory WHERE id = ${bHayId}`;
    expect(Number(h.quantity)).toBe(5);
    const [p] = await db<[{ name: string }]>`SELECT name FROM pastures WHERE id = ${bPastureId}`;
    expect(p.name).toBe("B-South Pasture");
    const [e] = await db<[{ status: string }]>`SELECT status FROM equipment WHERE id = ${bEquipId}`;
    expect(e.status).toBe("in-service");
  });

  test("complete/reopen scoped to Ranch A cannot complete Ranch B's task", async () => {
    const done = await db`
      UPDATE tasks SET status='completed', updated_at=now()
      WHERE id=${bTaskId} AND operation_id=${opAId} RETURNING id`;
    expect(done.length).toBe(0);
    const [t] = await db<[{ status: string }]>`SELECT status FROM tasks WHERE id = ${bTaskId}`;
    expect(t.status).toBe("to_do");
  });

  test("a DELETE scoped to Ranch A cannot delete Ranch B's task", async () => {
    const deleted = await db`DELETE FROM tasks WHERE id=${bTaskId} AND operation_id=${opAId} RETURNING id`;
    expect(deleted.length).toBe(0);
    expect((await db`SELECT id FROM tasks WHERE id = ${bTaskId}`).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end persisted writes for saveHay / savePasture / saveEquipment —
// insert → assert row → re-fetch scoped by operation shows it (Ranch A)
// ---------------------------------------------------------------------------

describe("module persisted writes (local DB, Ranch A scoped)", () => {
  test("saveHay-shaped insert persists and is re-fetched by an operation-scoped read", async () => {
    const [hay] = await db<[{ id: number }]>`
      INSERT INTO hay_inventory (operation_id, feed_type, cutting, field_or_source, storage_location,
                                 quantity, unit, bale_weight_lbs, date_acquired, low_stock_threshold, notes)
      VALUES (${opAId}, 'alfalfa', 'second', 'North Field', 'Barn 1',
              24, 'bales', 1450, '2026-08-01', 10, 'test hay row')
      RETURNING id`;
    const rows = await db<[{ feed_type: string; quantity: string; notes: string }]>`
      SELECT feed_type, quantity::float8 AS quantity, notes FROM hay_inventory
      WHERE id = ${hay.id} AND operation_id = ${opAId}`;
    expect(rows.length).toBe(1);
    expect(rows[0].feed_type).toBe("alfalfa");
    expect(Number(rows[0].quantity)).toBe(24);
    expect(rows[0].notes).toBe("test hay row");
  });

  test("savePasture-shaped insert persists and is re-fetched by an operation-scoped read", async () => {
    const [p] = await db<[{ id: number }]>`
      INSERT INTO pastures (operation_id, name, size_acres, location, status, soil_type, notes)
      VALUES (${opAId}, 'A-North Paddock', 42.5, 'North side', 'resting', 'sandy loam', 'test pasture row')
      RETURNING id`;
    const rows = await db<[{ name: string; size_acres: string; soil_type: string }]>`
      SELECT name, size_acres::float8 AS size_acres, soil_type FROM pastures
      WHERE id = ${p.id} AND operation_id = ${opAId}`;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("A-North Paddock");
    expect(Number(rows[0].size_acres)).toBe(42.5);
    expect(rows[0].soil_type).toBe("sandy loam");
  });

  test("saveEquipment-shaped insert persists and is re-fetched by an operation-scoped read", async () => {
    const [e] = await db<[{ id: number }]>`
      INSERT INTO equipment (operation_id, name, category, make, model, year, hours, miles,
                             location, fuel_type, notes, status)
      VALUES (${opAId}, 'A-Hay Truck', 'truck', 'Ford', 'F-450', 2018, NULL, 98400,
              'Shop', 'diesel', 'test equipment row', 'in-service')
      RETURNING id`;
    const rows = await db<[{ name: string; category: string; miles: string; fuel_type: string }]>`
      SELECT name, category, miles::float8 AS miles, fuel_type FROM equipment
      WHERE id = ${e.id} AND operation_id = ${opAId}`;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("A-Hay Truck");
    expect(rows[0].category).toBe("truck");
    expect(Number(rows[0].miles)).toBe(98400);
    expect(rows[0].fuel_type).toBe("diesel");
  });
});