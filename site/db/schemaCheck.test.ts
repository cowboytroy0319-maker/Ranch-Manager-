// ============================================================================
// DEPLOY-TIME SCHEMA GATE — the constraint hole the independent verifier proved
// ============================================================================
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ranch_ci \
//     bun test db/schemaCheck.test.ts
//
// THE PROOF THIS SUITE ENCODES (verbatim, from the verifier's artifact
// `schemacheck-GAP-dropped-unique-constraints.txt`)
//   With `uq_restock_log_operation_request` AND
//   `uq_pasture_activities_operation_request` dropped from a fully-migrated
//   database, `bun run db:check-schema` printed
//      OK — 20 migrations applied, 10 required objects present.
//   and exited 0. The two UNIQUE constraints are the database-level half of the
//   restock double-submit guarantee, so a drifted database shipped with it gone.
//
// WHAT IS ASSERTED HERE
//   1. `readTargetSchema` + `evaluateSchema` on a real, fully-migrated scratch
//      database: OK.
//   2. Dropping EITHER `uq_*_operation_request` makes it REFUSE and name that
//      constraint.
//   3. The real CLI (`bun db/schemaCheck.ts`) exits **1** on the broken database
//      and **0** on the healthy one — the gate's actual exit code, not a
//      re-implementation of it.
//
// SAFETY
//   Local Postgres only (refuses any DATABASE_URL without 127.0.0.1). It uses its
//   own scratch database `ranch_pf_gate`; the CI database `ranch_ci` and the
//   preview scratch database are never modified.
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitStatements } from "./migrate";
import {
  evaluateSchema,
  localMigrationFiles,
  readTargetSchema,
  requiredObjectKey,
} from "./schemaCheck";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "schemaCheck.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

type Sql = postgres.Sql;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const GATE_DB = "ranch_pf_gate";
const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const UQ_RESTOCK = "uq_restock_log_operation_request";
const UQ_PASTURE = "uq_pasture_activities_operation_request";

const withDb = (dbName: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
};

const admin = postgres(withDb("postgres"), { max: 1, onnotice: () => {} });
let db: Sql;

async function applyAllMigrations(target: Sql): Promise<void> {
  await target.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    await target.begin(async (tx) => {
      for (const stmt of statements) await tx.unsafe(stmt);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
  }
}

/** The gate, exactly as `bun run db:check-schema` runs it — same entry point,
 *  same environment, so the exit code asserted here is the one CI/publish see. */
function runGateCli(dbName: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: withDb(dbName) };
  for (const key of [
    "APP_ENV",
    "PREVIEW_DATABASE_URL",
    "PREVIEW_ENV_EXPECTED",
    "SKIP_SCHEMA_CHECK",
    "SCHEMA_CHECK_WARN_ONLY",
  ]) {
    delete env[key];
  }
  return spawnSync(process.execPath, ["db/schemaCheck.ts"], {
    cwd: SITE_DIR,
    encoding: "utf8",
    env,
  });
}

const check = async (): Promise<ReturnType<typeof evaluateSchema>> => {
  const { appliedMigrations, presentObjects } = await readTargetSchema(db);
  return evaluateSchema({
    localMigrations: localMigrationFiles(),
    appliedMigrations,
    presentObjects,
  });
};

beforeAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${GATE_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${GATE_DB}`);
  db = postgres(withDb(GATE_DB), { max: 1, onnotice: () => {} });
  await applyAllMigrations(db);
});

afterAll(async () => {
  try {
    await db.end();
  } catch {
    /* best effort */
  }
  await admin.unsafe(`DROP DATABASE IF EXISTS ${GATE_DB} WITH (FORCE)`);
  await admin.end();
});

describe("a correct database passes the gate", () => {
  test("every migration applied + every required object present (including both uq_* constraints)", async () => {
    const result = await check();
    expect(result.missingMigrations).toEqual([]);
    expect(result.missingObjects).toEqual([]);
    expect(result.ok).toBe(true);
    // The two constraints the manifest gained are really required objects now.
    const { presentObjects } = await readTargetSchema(db);
    expect(presentObjects).toContain(`constraint:${UQ_RESTOCK}`);
    expect(presentObjects).toContain(`constraint:${UQ_PASTURE}`);
  });

  test("the CLI exits 0 and prints OK", () => {
    const run = runGateCli(GATE_DB);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("OK — 20 migrations applied, 12 required objects present.");
  });
});

describe("the verifier's drift case is now REFUSED", () => {
  test("dropping uq_restock_log_operation_request fails the check", async () => {
    await db.unsafe(`ALTER TABLE restock_log DROP CONSTRAINT ${UQ_RESTOCK}`);
    try {
      const result = await check();
      expect(result.ok).toBe(false);
      expect(result.missingObjects.map(requiredObjectKey)).toEqual([`constraint:${UQ_RESTOCK}`]);

      const run = runGateCli(GATE_DB);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("REFUSED");
      expect(run.stderr).toContain(`constraint:${UQ_RESTOCK}`);
      expect(run.stderr).toContain("0018_product_blocker.sql");
    } finally {
      await db.unsafe(
        `ALTER TABLE restock_log ADD CONSTRAINT ${UQ_RESTOCK} UNIQUE (operation_id, client_request_id)`
      );
    }
    expect((await check()).ok).toBe(true);
  });

  test("dropping uq_pasture_activities_operation_request fails the check too", async () => {
    await db.unsafe(`ALTER TABLE pasture_activities DROP CONSTRAINT ${UQ_PASTURE}`);
    try {
      const result = await check();
      expect(result.ok).toBe(false);
      expect(result.missingObjects.map(requiredObjectKey)).toEqual([`constraint:${UQ_PASTURE}`]);

      const run = runGateCli(GATE_DB);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`constraint:${UQ_PASTURE}`);
    } finally {
      await db.unsafe(
        `ALTER TABLE pasture_activities ADD CONSTRAINT ${UQ_PASTURE} UNIQUE (operation_id, client_request_id)`
      );
    }
    expect((await check()).ok).toBe(true);
  });

  test("the old hole is genuinely closed: the gate no longer says OK with either dropped", async () => {
    // Same experiment the verifier ran: both constraints gone at once.
    await db.unsafe(`ALTER TABLE restock_log DROP CONSTRAINT ${UQ_RESTOCK}`);
    await db.unsafe(`ALTER TABLE pasture_activities DROP CONSTRAINT ${UQ_PASTURE}`);
    try {
      const result = await check();
      expect(result.ok).toBe(false);
      expect(result.missingObjects.map(requiredObjectKey).sort()).toEqual(
        [`constraint:${UQ_RESTOCK}`, `constraint:${UQ_PASTURE}`].sort()
      );
      const run = runGateCli(GATE_DB);
      expect(run.status).not.toBe(0);
      expect(run.stdout).not.toContain("OK —");
    } finally {
      await db.unsafe(
        `ALTER TABLE restock_log ADD CONSTRAINT ${UQ_RESTOCK} UNIQUE (operation_id, client_request_id)`
      );
      await db.unsafe(
        `ALTER TABLE pasture_activities ADD CONSTRAINT ${UQ_PASTURE} UNIQUE (operation_id, client_request_id)`
      );
    }
    expect((await check()).ok).toBe(true);
  });
});
