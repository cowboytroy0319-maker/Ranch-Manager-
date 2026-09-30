// ============================================================================
// PREFLIGHT 0018 — does it actually REFUSE a database the run would fail on?
// ============================================================================
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ranch_ci \
//     bun test db/preflight0018.test.ts
//
// WHY THIS SUITE EXISTS
//   The preflight that preceded the failed 2026-09-30 production run was a list
//   of SELECTs a HUMAN read and diffed. The independent verifier proved the hole
//   that matters: `DROP CONSTRAINT IF EXISTS expenses_category_check` is
//   NAME-ONLY, so a renamed constraint makes the fix fail again (23514) while
//   `psql -f` still exits 0 and every printed row looks plausible.
//   `db/preflight0018.ts` turns every condition into an assertion with an exit
//   code. This suite PROVES the assertions fail when they should:
//
//     * one test per injected fault, each on its own TEMPLATE clone of a
//       database shaped exactly like production (0001…0017 + 0019 + 0020, 0018
//       ABSENT, legacy category rows) — the fault makes the preflight REFUSE and
//       names the failing check;
//     * the true shape PASSES every check (so the gate is not a fire alarm that
//       always rings);
//     * an unrelated extra CHECK on `expenses` also PASSES — the old runbook's
//       "any other CHECK → abort" criterion over-aborted, and this pins the fix.
//
// SAFETY
//   A local Postgres only: the file refuses to run unless DATABASE_URL contains
//   127.0.0.1, and every database it touches is named `ranch_pf_*` and created
//   by this suite. The owner's Neon is never reached, and neither is the
//   preview scratch database the owner demos from.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitStatements } from "./migrate";
import {
  LEGACY_CATEGORY_VALUES,
  TARGET_MIGRATION,
  runPreflight,
  type PreflightReport,
} from "./preflight0018";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "preflight0018.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

type Sql = postgres.Sql;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const BASE = "ranch_pf_true";

// ---------------------------------------------------------------------------
// HARNESS TIMING — why every hook below carries an explicit timeout
// ---------------------------------------------------------------------------
// The hooks here run real DDL: a template database is built once per FILE in
// `beforeAll`, each fault test clones it, and `afterAll` drops every clone.
// `CREATE DATABASE`/`DROP DATABASE` each force a cluster-wide checkpoint, so this
// teardown is measured in hundreds of milliseconds here and in seconds on a
// shared CI runner — and bun's DEFAULT per-hook timeout is 5s, which is a hard
// failure of the whole file.
//
// That is exactly what happened on 2026-09-30 (head 4682987, run 36665807249):
// every product assertion in this file passed (the last one at 03:45:47.49) and
// the run still went red because `afterAll` hit 5.0s while dropping the clones:
//   (fail) (unnamed) [5000.11ms]
//     ^ a beforeEach/afterEach hook timed out for this test.
// Reproduced locally with a 6s hook: identical message at 5001ms without an
// explicit timeout, green with one. So the timeouts below are not cosmetic.
//
// The teardown is also cheaper and cannot hang: the clones are dropped in
// PARALLEL, every drop is best-effort (a failed drop is reported and the file
// still passes — the next run's `clone()` drops the name anyway), and both
// `end()` calls are bounded.
const HOOK_TIMEOUT_MS = 120_000;
const END_TIMEOUT_S = 5;
// One test waits out a deliberately-held transaction (`pg_sleep(3)`, measured at
// 3914ms on the CI runner): under the default 5s that is already a flake.
const LOCK_TEST_TIMEOUT_MS = 30_000;

const withDb = (dbName: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
};

const client = (dbName: string): Sql => postgres(withDb(dbName), { max: 1, onnotice: () => {} });

/** Apply one file the way `db/migrate.ts` does: one transaction, statements in
 *  file order, the filename recorded before COMMIT. */
async function applyFile(db: Sql, file: string): Promise<void> {
  const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  await db.begin(async (tx) => {
    for (const stmt of statements) await tx.unsafe(stmt);
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
}

/** The production shape: every migration EXCEPT 0018, in filename order. */
const preRunFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== TARGET_MIGRATION)
    .sort();

async function buildTrueShape(db: Sql): Promise<void> {
  await db.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const file of preRunFiles()) await applyFile(db, file);
}

/** Production-shaped legacy rows: 12 expenses across five legacy categories
 *  (the 2026-09-30 reading — no `fuel` row) + 10 pastures with acreage. */
async function seedLegacyRows(db: Sql): Promise<void> {
  const [{ id: opId }] = await db<[{ id: number }]>`SELECT id FROM operations ORDER BY id LIMIT 1`;
  for (let i = 1; i <= 10; i += 1) {
    await db.unsafe(
      `INSERT INTO pastures (operation_id, name, size_acres, location, status)
       VALUES (${opId}, 'Paddock ${i}', ${40 + i * 5}, 'North', 'resting')`
    );
  }
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
  ];
  for (const [date, category, cents, vendor] of rows) {
    await db.unsafe(
      `INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
       VALUES (${opId}, '${date}', '${category}', ${cents}, '${vendor}')`
    );
  }
}

const admin = postgres(withDb("postgres"), { max: 1, onnotice: () => {} });
let baseReport: PreflightReport;

beforeAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${BASE}`);
  const db = client(BASE);
  try {
    await buildTrueShape(db);
    await seedLegacyRows(db);
    baseReport = await runPreflight(db, {
      target: `${BASE} (scratch)`,
      modeSource: "test",
      mode: "production",
    });
  } finally {
    await db.end({ timeout: END_TIMEOUT_S });
  }
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  // Enumerate first, then drop every clone AT ONCE. Sequential drops were the
  // part of this file that went red on the CI runner (>5s); one round trip in
  // parallel is both cheaper and bounded by the hook timeout above.
  const clones = await admin<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE 'ranch_pf_%'`;
  const results = await Promise.allSettled(
    clones.map(({ datname }) =>
      admin.unsafe(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`)
    )
  );
  const failed = results
    .map((r, i) => (r.status === "rejected" ? clones[i].datname : null))
    .filter((n): n is string => n !== null);
  if (failed.length > 0) {
    // Reported, never fatal: a leftover scratch database is dropped by the next
    // run's `clone()`, and a slow disk must not turn every green assertion red.
    console.warn(`[preflight0018] could not drop: ${failed.join(", ")}`);
  }
  await admin.end({ timeout: END_TIMEOUT_S });
}, HOOK_TIMEOUT_MS);

/** Clone the true shape and return a connection to the clone. */
async function clone(name: string, inject: (db: Sql) => Promise<void>): Promise<Sql> {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${BASE}`);
  const db = client(name);
  await inject(db);
  return db;
}

/** The preflight must REFUSE, and it must name each of these checks. */
async function expectRefused(db: Sql, ids: string[]): Promise<PreflightReport> {
  const report = await runPreflight(db, { target: "clone", modeSource: "test", mode: "production" });
  expect(report.ok).toBe(false);
  expect(report.failures.map((f) => f.id).sort()).toEqual([...ids].sort());
  return report;
}

describe("the true production shape passes every check", () => {
  test("19 migrations applied, 0018 absent — and the preflight says OK", () => {
    expect(baseReport.ok).toBe(true);
    expect(baseReport.failures).toEqual([]);
  });

  test("the transcript is greppable and names every check it ran", () => {
    const ids = baseReport.checks.map((c) => c.id);
    for (const id of [
      "env",
      "readonly",
      "queries",
      "migrations",
      "objects-absent",
      "columns-absent",
      "category-not-null",
      "category-check-present",
      "category-check-shape",
      "no-rival-category-check",
      "category-values",
      "server-version",
      "no-long-transactions",
      "rollback-precondition",
    ]) {
      expect(ids).toContain(id);
    }
    expect(baseReport.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("injected faults — the preflight REFUSES each one", () => {
  test("renamed category constraint (the exact hole the verifier proved)", async () => {
    const db = await clone("ranch_pf_f1_renamed", async (c) => {
      await c.unsafe(`ALTER TABLE expenses RENAME CONSTRAINT expenses_category_check TO expenses_cat_check`);
    });
    try {
      const report = await expectRefused(db, [
        "category-check-present",
        "category-check-shape",
        "no-rival-category-check",
      ]);
      const observed = report.failures.find((f) => f.id === "category-check-present")?.observed ?? "";
      expect(observed).toContain("expenses_cat_check");
      expect(observed).toContain("NOT FOUND");
    } finally {
      await db.end();
    }
  });

  test("category constraint dropped entirely", async () => {
    const db = await clone("ranch_pf_f2_dropped", async (c) => {
      await c.unsafe(`ALTER TABLE expenses DROP CONSTRAINT expenses_category_check`);
    });
    try {
      await expectRefused(db, ["category-check-present", "category-check-shape"]);
    } finally {
      await db.end();
    }
  });

  test("category constraint with a wrong value set (five values, 'other' missing)", async () => {
    const db = await clone("ranch_pf_f3_wrongset", async (c) => {
      await c.unsafe(`ALTER TABLE expenses DROP CONSTRAINT expenses_category_check`);
      // NOT VALID: the existing rows are NOT re-checked (that is not what this
      // fault is about) — only the constraint's DEFINITION differs.
      await c.unsafe(`ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
        CHECK (category IN ('feed', 'vet_health', 'maintenance', 'insurance', 'fuel')) NOT VALID`);
    });
    try {
      await expectRefused(db, ["category-check-shape"]);
    } finally {
      await db.end();
    }
  });

  test("category-named constraint that does not constrain `category`", async () => {
    const db = await clone("ranch_pf_f4_wrongcol", async (c) => {
      await c.unsafe(`ALTER TABLE expenses DROP CONSTRAINT expenses_category_check`);
      await c.unsafe(`ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
        CHECK (vendor = ANY (ARRAY['a', 'b'])) NOT VALID`);
    });
    try {
      await expectRefused(db, ["category-check-shape"]);
    } finally {
      await db.end();
    }
  });

  test("a category value outside the legacy six (reachable only via a NOT VALID constraint)", async () => {
    const db = await clone("ranch_pf_f5_value", async (c) => {
      // A NOT VALID constraint skips the initial scan but still enforces new
      // rows — so the out-of-list value has to be written while the allow-list is
      // OFF, then the constraint re-added NOT VALID around it. That is exactly
      // the state the verifier produced for FAULT 3.
      await c.unsafe(`ALTER TABLE expenses DROP CONSTRAINT expenses_category_check`);
      await c.unsafe(`INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor)
        SELECT id, '2026-08-20', 'misc', 100, 'Odd' FROM operations ORDER BY id LIMIT 1`);
      await c.unsafe(`ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
        CHECK (category IN (${LEGACY_CATEGORY_VALUES.map((v) => `'${v}'`).join(", ")})) NOT VALID`);
    });
    try {
      const report = await expectRefused(db, ["category-values"]);
      expect(report.failures[0].observed).toContain("misc");
    } finally {
      await db.end();
    }
  });

  test("0018 already recorded as applied", async () => {
    const db = await clone("ranch_pf_f6_applied", async (c) => {
      await c`INSERT INTO schema_migrations (name) VALUES (${TARGET_MIGRATION})`;
    });
    try {
      const report = await expectRefused(db, ["migrations"]);
      expect(report.failures[0].observed).toContain("ALREADY RECORDED");
    } finally {
      await db.end();
    }
  });

  test("an expected migration is missing (0020)", async () => {
    const db = await clone("ranch_pf_f7_missing", async (c) => {
      await c`DELETE FROM schema_migrations WHERE name = '0020_password_reset.sql'`;
    });
    try {
      const report = await expectRefused(db, ["migrations"]);
      expect(report.failures[0].observed).toContain("MISSING 0020_password_reset.sql");
    } finally {
      await db.end();
    }
  });

  test("one of the four 0018 objects already exists", async () => {
    const db = await clone("ranch_pf_f8_object", async (c) => {
      await c.unsafe(`CREATE TABLE restock_log (id serial PRIMARY KEY)`);
    });
    try {
      const report = await expectRefused(db, ["objects-absent"]);
      expect(report.failures[0].observed).toContain("restock_log");
    } finally {
      await db.end();
    }
  });

  test("one of the three 0018 columns already exists", async () => {
    const db = await clone("ranch_pf_f9_column", async (c) => {
      await c.unsafe(`ALTER TABLE expenses ADD COLUMN paid_by text`);
    });
    try {
      const report = await expectRefused(db, ["columns-absent"]);
      expect(report.failures[0].observed).toContain("paid_by");
    } finally {
      await db.end();
    }
  });

  test("expenses.category made nullable (a legacy row could then hide a NULL)", async () => {
    const db = await clone("ranch_pf_f10_nullcol", async (c) => {
      await c.unsafe(`ALTER TABLE expenses ALTER COLUMN category DROP NOT NULL`);
    });
    try {
      await expectRefused(db, ["category-not-null"]);
    } finally {
      await db.end();
    }
  });

  test("a pasture row with a NULL acreage (the documented rollback would fail)", async () => {
    const db = await clone("ranch_pf_f11_nullacres", async (c) => {
      await c.unsafe(`ALTER TABLE pastures ALTER COLUMN size_acres DROP NOT NULL`);
      await c.unsafe(
        `UPDATE pastures SET size_acres = NULL WHERE id = (SELECT min(id) FROM pastures)`
      );
    });
    try {
      await expectRefused(db, ["rollback-precondition"]);
    } finally {
      await db.end();
    }
  });

  test("the process is resolving the PREVIEW database, not production", async () => {
    const db = await clone("ranch_pf_f12_mode", async () => {});
    try {
      const report = await runPreflight(db, {
        target: "preview",
        modeSource: "APP_ENV=preview",
        mode: "preview",
      });
      expect(report.ok).toBe(false);
      expect(report.failures.map((f) => f.id)).toEqual(["env"]);
    } finally {
      await db.end();
    }
  });

  test("a competing session is holding a transaction open", async () => {
    const db = await clone("ranch_pf_f13_locked", async () => {});
    const holder = client("ranch_pf_f13_locked");
    let started = false;
    const holding = holder.begin(async (tx) => {
      started = true;
      await tx.unsafe("SELECT pg_sleep(3)");
    });
    for (let i = 0; i < 60 && !started; i += 1) await new Promise((r) => setTimeout(r, 25));
    try {
      const report = await runPreflight(db, {
        target: "clone",
        modeSource: "test",
        mode: "production",
        longTransactionSeconds: 0,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.map((f) => f.id)).toEqual(["no-long-transactions"]);
    } finally {
      await holding.catch(() => {});
      await holder.end({ timeout: END_TIMEOUT_S });
      await db.end({ timeout: END_TIMEOUT_S });
    }
  }, LOCK_TEST_TIMEOUT_MS);
});

describe("no false alarms — the cases the old runbook wrongly aborted on", () => {
  test("an unrelated extra CHECK on expenses still passes (it does not affect the run)", async () => {
    const db = await clone("ranch_pf_ok_extracheck", async (c) => {
      await c.unsafe(
        `ALTER TABLE expenses ADD CONSTRAINT expenses_vendor_len_check CHECK (char_length(vendor) <= 200)`
      );
    });
    try {
      const report = await runPreflight(db, {
        target: "clone",
        modeSource: "test",
        mode: "production",
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      const rival = report.checks.find((c) => c.id === "no-rival-category-check");
      expect(rival?.observed).toContain("expenses_vendor_len_check");
    } finally {
      await db.end();
    }
  });

  test("the legacy six are exactly 0007's list (the gate's expected allow-list)", () => {
    expect([...LEGACY_CATEGORY_VALUES]).toEqual([
      "feed",
      "vet_health",
      "maintenance",
      "insurance",
      "fuel",
      "other",
    ]);
  });
});
