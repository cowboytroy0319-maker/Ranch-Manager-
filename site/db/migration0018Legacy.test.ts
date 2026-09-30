// ============================================================================
// 0018 on a LEGACY-SHAPED database — regression test for the production failure
// of 2026-09-30 (SQLSTATE 23514 on the FIRST statement of 0018).
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/ranch_ci \
//     bun test db/migration0018Legacy.test.ts
//
// WHAT THIS PROVES, AND WHY IT EXISTS
//   `0018_product_blocker.sql` remaps the six LEGACY expenses categories
//   ('feed','vet_health','maintenance','insurance','fuel','other', defined by
//   0007_expenses.sql) to the twelve NEW ones, then swaps the CHECK constraint.
//   The first version of the file ran the remaps BEFORE dropping the old
//   constraint, so on a database whose `expenses` table actually holds a legacy
//   value, Postgres rejected the very first UPDATE:
//
//     PostgresError 23514: new row for relation "expenses" violates check
//     constraint "expenses_category_check"     (failing row: category 'hay_feed')
//
//   Production was the ONLY database with legacy rows. CI and the preview
//   scratch database are created empty and seeded new-style, so the six UPDATEs
//   matched zero rows there and the defect was invisible — 20/20 migrations
//   "green" while the one run that mattered rolled back.
//
//   This suite therefore does what no other suite did: it builds a scratch
//   database from `0001…0017` ONLY, fills it with production-shaped LEGACY rows,
//   and then applies `0018` the way the runner does (one transaction per file,
//   the runner's own statement splitter). It carries the legacy data in CI from
//   now on, so an ordering regression of this class fails here instead of in
//   production.
//
// SAFETY
//   Two dedicated scratch databases on a LOCAL Postgres only:
//     ranch_legacy_0018        — 0001..0017 + legacy rows + the real 0018
//     ranch_legacy_0018_probe  — 0001..0017 + legacy rows, used to demonstrate
//                                the old (broken) order failing
//   The file refuses to run unless DATABASE_URL contains 127.0.0.1, exactly like
//   the other DB-backed suites, so it can never touch the owner's Neon.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitStatements } from "./migrate";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "migration0018Legacy.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const TARGET = "0018_product_blocker.sql";
const LEGACY_DB = "ranch_legacy_0018";
const PROBE_DB = "ranch_legacy_0018_probe";

/** The six values 0007_expenses.sql allowed, and the twelve 0018 allows. */
const LEGACY_CATEGORIES = ["feed", "vet_health", "maintenance", "insurance", "fuel", "other"] as const;
const NEW_CATEGORIES = [
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
] as const;
const LEGACY_TO_NEW: Record<string, string> = {
  feed: "hay_feed",
  vet_health: "veterinary",
  maintenance: "repairs_maintenance",
  insurance: "insurance",
  fuel: "fuel",
  other: "other",
};

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

const withDb = (dbName: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
};

/** Same split the runner uses (`db/migrate.ts`): strip `--` lines, split on `;`. */
const statementsOf = (file: string): string[] =>
  splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));

/** Apply one migration file exactly as `runMigrations()` does: one transaction,
 *  every statement in file order, the filename recorded before COMMIT. */
async function applyFileLikeTheRunner(db: Sql, file: string): Promise<number> {
  const statements = statementsOf(file);
  await db.begin(async (tx) => {
    for (const stmt of statements) await tx.unsafe(stmt);
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  return statements.length;
}

/** Every migration BEFORE 0018, in filename order — i.e. the schema production
 *  was actually at (production carries 0019/0020 as well, but nothing 0018 does
 *  depends on them, and both are already applied there). */
function preMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < TARGET)
    .sort();
}

const run = (db: Sql, sql: string): Promise<Row[]> => db.unsafe<Row[]>(sql);

async function scalar<T = string>(db: Sql, sql: string): Promise<T> {
  const rows = await db.unsafe<Array<{ v: T }>>(`SELECT (${sql}) AS v`);
  return rows[0].v;
}

/**
 * Production-shaped legacy fixture. Counts mirror the real production database
 * (12 expenses: feed 3 / vet_health 3 / maintenance 3 / insurance 2 / other 1;
 * 10 pastures; 8 hay_inventory; 7 feed_inventory; 1 user; 1 operation) with ONE
 * documented addition: a 'fuel' row, so that all six legacy category values are
 * exercised by at least one row. Production happened to have no fuel row, which
 * is why nobody noticed that statements 4-6 of 0018 are no-op self-assignments.
 */
async function seedLegacyRows(db: Sql): Promise<void> {
  const opId = await scalar<number>(db, `SELECT id FROM operations ORDER BY id LIMIT 1`);

  await run(
    db,
    `INSERT INTO users (email, password_hash) VALUES ('owner@example.com', 'legacy-fixture-hash')`
  );
  await run(db, `INSERT INTO herd_groups (operation_id, name, species) VALUES
      (${opId}, 'Cow Herd', 'cattle'), (${opId}, 'Saddle Horses', 'horse')`);

  for (let i = 1; i <= 10; i += 1) {
    await run(
      db,
      `INSERT INTO pastures (operation_id, name, size_acres, location, status)
       VALUES (${opId}, 'Paddock ${i}', ${40 + i * 5}, 'North', '${i % 3 === 0 ? "grazing" : "resting"}')`
    );
  }
  for (let i = 1; i <= 8; i += 1) {
    await run(
      db,
      `INSERT INTO hay_inventory (operation_id, feed_type, cutting, storage_location, quantity, unit, low_stock_threshold)
       VALUES (${opId}, 'grass', '2nd', 'Barn ${i}', ${80 + i}, 'bales', 10)`
    );
  }
  for (let i = 1; i <= 7; i += 1) {
    await run(
      db,
      `INSERT INTO feed_inventory (operation_id, name, category, quantity, unit, low_stock_threshold)
       VALUES (${opId}, 'Feed ${i}', 'supplement', ${500 + i}, 'lbs', 50)`
    );
  }
  await run(db, `INSERT INTO equipment (operation_id, name, category) VALUES (${opId}, 'Truck', 'truck')`);

  // The 12 production-shaped legacy expenses. Row 1 is the exact row production's
  // failed run reported (id 1, 2026-08-05, 'Chappell Feed & Seed', $1,240.00).
  const rows: Array<[string, string, number, string]> = [
    ["2026-08-05", "feed", 124000, "Chappell Feed & Seed"],
    ["2026-08-06", "feed", 45000, "Chappell Feed & Seed"],
    ["2026-08-07", "feed", 18000, "Johnson Hay"],
    ["2026-08-08", "vet_health", 32000, "Ag Vet Clinic"],
    ["2026-08-09", "vet_health", 15000, "Ag Vet Clinic"],
    ["2026-08-10", "vet_health", 7200, "Ag Vet Clinic"],
    ["2026-08-11", "maintenance", 98000, "Tractor Supply Service"],
    ["2026-08-12", "maintenance", 2500, "Tractor Supply Service"],
    ["2026-08-13", "maintenance", 41000, "Kubota Dealer"],
    ["2026-08-14", "insurance", 210000, "Farm Bureau"],
    ["2026-08-15", "insurance", 90000, "Farm Bureau"],
    ["2026-08-16", "other", 6000, "Misc"],
    ["2026-08-17", "fuel", 30000, "Co-op Diesel"], // the extra 13th fixture row
  ];
  for (const [date, category, cents, vendor] of rows) {
    await run(
      db,
      `INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
       VALUES (${opId}, '${date}', '${category}', ${cents}, '${vendor}')`
    );
  }
}

/** Everything 0018 must leave behind, in one comparable string. Used to prove a
 *  re-run is a TRUE no-op (definitions/objects/rows, not object OIDs). */
async function schemaFingerprint(db: Sql): Promise<string> {
  const constraints = await run(
    db,
    `SELECT conname || ' :: ' || pg_get_constraintdef(oid) AS v
       FROM pg_constraint
      WHERE conrelid = 'expenses'::regclass AND contype = 'c'
      ORDER BY conname`
  );
  const columns = await run(
    db,
    `SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS v
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('expenses', 'pastures')
      ORDER BY table_name, column_name`
  );
  const objects = await run(
    db,
    `SELECT kind || ':' || name AS v FROM (
       SELECT 'table' AS kind, tablename AS name FROM pg_tables
         WHERE schemaname = 'public' AND tablename IN ('restock_log', 'pasture_activities', 'livestock_movements')
       UNION ALL
       SELECT 'index', indexname FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'expenses_source_once_uniq'
       UNION ALL
       SELECT 'migration', name FROM schema_migrations
     ) t ORDER BY kind, name`
  );
  const counts: string[] = [];
  for (const table of ["expenses", "pastures", "hay_inventory", "feed_inventory", "restock_log"]) {
    // Tolerant on purpose: restock_log does not exist BEFORE 0018 runs.
    const exists = await scalar<boolean>(db, `SELECT to_regclass('public.${table}') IS NOT NULL`);
    counts.push(
      `${table}=${exists ? String(await scalar<number>(db, `SELECT count(*)::int FROM ${table}`)) : "MISSING"}`
    );
  }
  const stringify = (rows: unknown[]) => JSON.stringify(rows);
  return [
    stringify(constraints),
    stringify(columns),
    stringify(objects),
    stringify(counts),
  ].join("\n");
}

const admin = postgres(withDb("postgres"), { max: 1, onnotice: () => {} });
let db: Sql;
let beforeFingerprint = "";
let afterFingerprint = "";
let statementCount = 0;
let probeError: { code: string; message: string } | null = null;
let categoriesBefore: string[] = [];

beforeAll(async () => {
  for (const name of [LEGACY_DB, PROBE_DB]) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
  }

  db = postgres(withDb(LEGACY_DB), { max: 1, onnotice: () => {} });
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  for (const file of preMigrationFiles()) await applyFileLikeTheRunner(db, file);
  await seedLegacyRows(db);
  categoriesBefore = (
    await run(db, `SELECT DISTINCT category FROM expenses ORDER BY category`)
  ).map((r) => r.category as string);

  // ---- the probe database: reproduce the OLD, broken statement order ----------
  const probe = postgres(withDb(PROBE_DB), { max: 1, onnotice: () => {} });
  try {
    await run(
      probe,
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    );
    for (const file of preMigrationFiles()) await applyFileLikeTheRunner(probe, file);
    await seedLegacyRows(probe);
    // Statements 4-6 of the old file (self-assignments) are harmless — 'fuel' is
    // in BOTH allow-lists, so writing it back is allowed even under the old CHECK.
    await run(probe, `UPDATE expenses SET category = 'fuel' WHERE category = 'fuel'`);
    // Statement 1 of the old file, executed under the still-active OLD CHECK.
    try {
      await run(probe, `UPDATE expenses SET category = 'hay_feed' WHERE category = 'feed'`);
    } catch (err) {
      probeError = {
        code: (err as { code?: string }).code ?? "?",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } finally {
    await probe.end();
  }

  beforeFingerprint = await schemaFingerprint(db);
  statementCount = await applyFileLikeTheRunner(db, TARGET);
  afterFingerprint = await schemaFingerprint(db);
});

afterAll(async () => {
  try {
    await db.end();
  } catch {
    /* best effort */
  }
  await admin.end();
});

// ---------------------------------------------------------------------------
// 1. The root cause, reproduced permanently
// ---------------------------------------------------------------------------
describe("root cause — the OLD statement order on a database that holds legacy rows", () => {
  test("remapping 'feed' → 'hay_feed' while the legacy CHECK is still in force fails 23514", () => {
    expect(probeError).not.toBeNull();
    expect(probeError?.code).toBe("23514");
    expect(probeError?.message).toContain("expenses_category_check");
  });

  test("a same-value rewrite ('fuel' → 'fuel') is harmless under the old CHECK", () => {
    // If this assertion ever fails, the diagnosis is wrong: the old allow-list
    // would be rejecting an unchanged value, which is a different bug.
    expect(probeError?.message).not.toContain("fuel");
  });
});

// ---------------------------------------------------------------------------
// 2. The fix — 0018 applies on a database that already holds legacy rows
// ---------------------------------------------------------------------------
describe("the file's statement order (the exact defect that broke production)", () => {
  test("the constraint is DROPPED first, the remap runs next, the wider CHECK is added last", () => {
    const statements = statementsOf(TARGET);
    const drop = statements.findIndex((s) =>
      s.includes("DROP CONSTRAINT IF EXISTS expenses_category_check")
    );
    const firstRemap = statements.findIndex((s) => s.startsWith("UPDATE expenses SET category"));
    const add = statements.findIndex((s) => s.includes("ADD CONSTRAINT expenses_category_check"));
    expect(drop).toBe(0); // the very first statement in the file
    expect(firstRemap > drop).toBe(true);
    expect(add > firstRemap).toBe(true);
  });

  test("the file still splits into the 25 statements the review catalogued", () => {
    expect(statementCount).toBe(25);
  });
});

describe("0018 applies to a legacy-shaped database", () => {
  test("the fixture really is legacy-shaped: all six 0007 values, nothing else", () => {
    expect(categoriesBefore).toEqual([...LEGACY_CATEGORIES].sort());
  });

  test("the file runs to completion (no 23514) in ONE transaction, as the runner does", () => {
    expect(statementCount > 0).toBe(true);
    expect(afterFingerprint).not.toBe(beforeFingerprint);
  });

  test("every renamed legacy category is gone; the three unchanged ones keep their rows", async () => {
    const rows = await run(
      db,
      `SELECT category, count(*)::int AS n FROM expenses GROUP BY category ORDER BY category`
    );
    const byCategory = Object.fromEntries(rows.map((r) => [r.category as string, r.n as number]));
    // The fixture's per-value counts, checked against the remap mapping: a
    // RENAMED legacy value must be gone and its new name must hold its rows; an
    // UNCHANGED one (insurance / fuel / other) must still hold exactly its rows.
    const fixtureCounts: Record<string, number> = {
      feed: 3,
      vet_health: 3,
      maintenance: 3,
      insurance: 2,
      fuel: 1,
      other: 1,
    };
    for (const [legacy, count] of Object.entries(fixtureCounts)) {
      const target = LEGACY_TO_NEW[legacy];
      if (target !== legacy) expect(byCategory[legacy] ?? 0).toBe(0);
      expect(byCategory[target]).toBe(count);
    }
    expect(rows.reduce((sum, r) => sum + (r.n as number), 0)).toBe(13);
  });

  test("no expense row was lost or re-created — the exact production row is intact", async () => {
    const rows = await run(
      db,
      `SELECT id, expense_date::text AS d, amount_cents, vendor FROM expenses WHERE id = 1`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].d).toBe("2026-08-05");
    expect(rows[0].amount_cents).toBe(124000);
    expect(rows[0].vendor).toBe("Chappell Feed & Seed");
    expect(await scalar<number>(db, `SELECT count(*)::int FROM expenses`)).toBe(13);
  });

  test("the new 12-value CHECK is in force: legacy values rejected, new values accepted", async () => {
    let rejected: { code?: string } | null = null;
    try {
      await run(db, `UPDATE expenses SET category = 'vet_health' WHERE id = 1`);
    } catch (err) {
      rejected = err as { code?: string };
    }
    expect(rejected?.code).toBe("23514");

    // A new-only value must be accepted (the remap must not have been followed by
    // a constraint that is narrower than the app's EXPENSE_CATEGORIES).
    for (const category of NEW_CATEGORIES) {
      await db.begin(async (tx) => {
        await tx.unsafe(`UPDATE expenses SET category = '${category}' WHERE id = 1`);
      });
    }
    await run(db, `UPDATE expenses SET category = 'hay_feed' WHERE id = 1`);
    const [row] = await run(db, `SELECT category FROM expenses WHERE id = 1`);
    expect(row.category).toBe("hay_feed");
  });

  test("the four 0018 objects and the three expenses columns all exist", async () => {
    const objects = await run(
      db,
      `SELECT v FROM (
         SELECT to_regclass('public.restock_log')::text AS v
         UNION ALL SELECT to_regclass('public.pasture_activities')::text
         UNION ALL SELECT to_regclass('public.livestock_movements')::text
         UNION ALL SELECT to_regclass('public.expenses_source_once_uniq')::text
       ) t`
    );
    expect(objects.map((o) => o.v)).toEqual([
      "restock_log",
      "pasture_activities",
      "livestock_movements",
      "expenses_source_once_uniq",
    ]);
    const cols = await run(
      db,
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'expenses' AND column_name IN ('paid_by', 'source_type', 'source_id')
        ORDER BY column_name`
    );
    expect(cols.map((c) => c.column_name)).toEqual(["paid_by", "source_id", "source_type"]);
  });

  test("the NOT NULL pastures columns were added over 10 existing rows with their defaults", async () => {
    const [row] = await run(
      db,
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE water_status = 'unknown')::int AS unknown_water,
              count(*) FILTER (WHERE condition = 'good')::int AS good_condition
         FROM pastures`
    );
    expect(row.n).toBe(10);
    expect(row.unknown_water).toBe(10);
    expect(row.good_condition).toBe(10);
    // The pre-existing values on the 10 rows survived the size_acres NOT NULL drop.
    expect(
      await scalar<number>(db, `SELECT count(*)::int FROM pastures WHERE size_acres IS NOT NULL`)
    ).toBe(10);
  });

  test("re-running the whole file is a clean no-op (idempotent, same end state)", async () => {
    const statements = statementsOf(TARGET);
    await db.begin(async (tx) => {
      for (const stmt of statements) await tx.unsafe(stmt);
    });
    expect(await schemaFingerprint(db)).toBe(afterFingerprint);
  });

  test("re-running the runner itself is a no-op — the filename is recorded once", async () => {
    const names = await run(
      db,
      `SELECT count(*)::int AS n FROM schema_migrations WHERE name = '${TARGET}'`
    );
    expect(names[0].n).toBe(1);
    expect(await scalar<number>(db, `SELECT count(*)::int FROM schema_migrations`)).toBe(
      preMigrationFiles().length + 1
    );
  });
});
