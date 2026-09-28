/**
 * ============================================================================
 * DEPLOY-TIME SCHEMA CHECK (audit defect D4).
 *
 *   bun run db:check-schema          # read-only; exits non-zero when the target
 *                                    # database is missing schema this build needs
 *
 * WHY THIS EXISTS
 *   The owner's live outage was a MISSING MIGRATION. The app and the build were
 *   fine; production simply had never had `0018_product_blocker.sql` applied, so
 *   every restock aborted on its first statement. Nothing in the deploy path
 *   noticed — the release went out and the failure only appeared when the owner
 *   tapped Save.
 *
 * WHAT IT CHECKS (two independent gates)
 *   1. EVERY migration file in `db/migrations/` is recorded as applied in the
 *      target's `schema_migrations` table. A new migration shipped without being
 *      applied fails the release — this alone would have caught 0018.
 *   2. Every object this build actually queries (the manifest below) exists.
 *      This catches a hand-edited/drifted database where the bookkeeping says
 *      "applied" but the objects are gone.
 *
 * SAFETY
 *   * READ-ONLY: SELECT + catalogue lookups only. No DDL, no writes, no
 *     migration is ever applied by this script.
 *   * It follows the SAME database selection as the app (APP_ENV → preview
 *     scratch DB, otherwise DATABASE_URL) and prints the target identity
 *     (`user@host:port/dbname`) — never a password or a connection string.
 *   * It is deliberately NOT blocked by the operator guard: refusing to LOOK at
 *     a production database is how an un-migrated release reaches the owner.
 *     It never writes, so looking is safe.
 *   * Escape hatch for an emergency release: `SKIP_SCHEMA_CHECK=1` (documented
 *     in publish.sh / build-vercel.sh) — deliberately noisy in the log.
 * ============================================================================
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, databaseGuard, rawSql } from "../src/db";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** One object this build relies on, and the migration that creates it. */
export type RequiredObject = {
  migration: string;
  kind: "table" | "column" | "index";
  /** Table name for a column (ignored for tables/indexes). */
  table?: string;
  name: string;
};

/** Human/JSON-safe key for a required object. */
export const requiredObjectKey = (o: RequiredObject): string =>
  o.kind === "column" ? `column:${o.table}.${o.name}` : `${o.kind}:${o.name}`;

/**
 * The objects the reliability-critical paths read and write. Kept deliberately
 * small and explicit: every entry is something a shipped feature would fail on
 * if it were missing (that is the whole point of the gate).
 */
export const REQUIRED_OBJECTS: RequiredObject[] = [
  // 0018 — the restock → expense feature the owner reported broken.
  { migration: "0018_product_blocker.sql", kind: "table", name: "restock_log" },
  { migration: "0018_product_blocker.sql", kind: "table", name: "pasture_activities" },
  { migration: "0018_product_blocker.sql", kind: "table", name: "livestock_movements" },
  { migration: "0018_product_blocker.sql", kind: "column", table: "expenses", name: "paid_by" },
  { migration: "0018_product_blocker.sql", kind: "column", table: "expenses", name: "source_type" },
  { migration: "0018_product_blocker.sql", kind: "column", table: "expenses", name: "source_id" },
  { migration: "0018_product_blocker.sql", kind: "index", name: "expenses_source_once_uniq" },
  // 0019 — permanent complimentary owner access / entitlements.
  { migration: "0019_owner_complimentary_access.sql", kind: "table", name: "operation_entitlements" },
  // 0020 — password reset.
  { migration: "0020_password_reset.sql", kind: "table", name: "password_resets" },
  { migration: "0020_password_reset.sql", kind: "table", name: "password_reset_requests" },
];

export type SchemaCheckInput = {
  /** Migration filenames present in this checkout, in filename order. */
  localMigrations: string[];
  /** Migration filenames recorded in the target's schema_migrations table. */
  appliedMigrations: string[];
  /** Keys (see requiredObjectKey) of the required objects that EXIST. */
  presentObjects: Iterable<string>;
};

export type SchemaCheckResult = {
  ok: boolean;
  /** Local migrations that the target has NOT applied (the 0018 case). */
  missingMigrations: string[];
  /** Required objects that do not exist, each naming its migration. */
  missingObjects: RequiredObject[];
  /** Every migration named by the two checks above, deduped, in order. */
  migrationsToApply: string[];
};

/**
 * PURE decision function — no I/O, so the gate itself is unit-testable. A
 * database passes only when every local migration is applied AND every required
 * object exists.
 */
export function evaluateSchema(input: SchemaCheckInput): SchemaCheckResult {
  const applied = new Set(input.appliedMigrations);
  const missingMigrations = input.localMigrations.filter((m) => !applied.has(m));
  const present = new Set(input.presentObjects);
  const missingObjects = REQUIRED_OBJECTS.filter((o) => !present.has(requiredObjectKey(o)));
  const migrationsToApply: string[] = [];
  for (const m of [...missingMigrations, ...missingObjects.map((o) => o.migration)]) {
    if (!migrationsToApply.includes(m)) migrationsToApply.push(m);
  }
  return {
    ok: missingMigrations.length === 0 && missingObjects.length === 0,
    missingMigrations,
    missingObjects,
    migrationsToApply,
  };
}

/** Read the migration filenames in this checkout. */
export const localMigrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

/** Collect what the TARGET database actually has. Read-only. */
export async function readTargetSchema(db: ReturnType<typeof rawSql>): Promise<{
  appliedMigrations: string[];
  presentObjects: string[];
}> {
  let appliedMigrations: string[] = [];
  try {
    appliedMigrations = (await db<{ name: string }[]>`SELECT name FROM schema_migrations`).map(
      (r) => r.name
    );
  } catch {
    // No schema_migrations at all → nothing has been applied. Report it as such;
    // the caller's message names the first migration to run.
    appliedMigrations = [];
  }
  const tables = await db<{ name: string }[]>`
    SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = ANY(current_schemas(false))`;
  const columns = await db<{ key: string }[]>`
    SELECT c.relname || '.' || a.attname AS key
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
      AND n.nspname = ANY(current_schemas(false))`;
  const indexes = await db<{ name: string }[]>`
    SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i' AND n.nspname = ANY(current_schemas(false))`;
  const present = new Set<string>();
  for (const t of tables) present.add(`table:${t.name}`);
  for (const c of columns) present.add(`column:${c.key}`);
  for (const i of indexes) present.add(`index:${i.name}`);
  return { appliedMigrations, presentObjects: [...present] };
}

export type RunSchemaCheckOptions = {
  /** true → report but do not fail (used for a loud, deliberate override). */
  warnOnly?: boolean;
};

/** Run the gate against the resolved target. Returns the process exit code. */
export async function runSchemaCheck(opts: RunSchemaCheckOptions = {}): Promise<number> {
  const guard = databaseGuard();
  const target = guard.target?.id ?? "none";
  if (guard.refusal) {
    console.error(
      `[db:check-schema] REFUSED (${guard.refusal.rule}) — ${guard.refusal.detail}\n` +
        `[db:check-schema] No connection was made. Fix the APP_ENV/PREVIEW_DATABASE_URL configuration first.`
    );
    return 2;
  }
  if (!guard.effectiveUrl) {
    console.error(
      `[db:check-schema] no database target resolved (mode: ${guard.modeSource}) — set DATABASE_URL (production) or APP_ENV=preview + PREVIEW_DATABASE_URL (preview).`
    );
    return 2;
  }
  console.log(`[db:check-schema] target ${target} (mode: ${guard.modeSource})`);
  const db = rawSql();
  const { appliedMigrations, presentObjects } = await readTargetSchema(db);
  const result = evaluateSchema({
    localMigrations: localMigrationFiles(),
    appliedMigrations,
    presentObjects,
  });
  if (result.ok) {
    console.log(
      `[db:check-schema] OK — ${localMigrationFiles().length} migrations applied, ${REQUIRED_OBJECTS.length} required objects present.`
    );
    return 0;
  }
  console.error(
    [
      "",
      "[db:check-schema] REFUSED — the target database is not ready for this build.",
      `[db:check-schema] target: ${target}`,
      result.missingMigrations.length
        ? `[db:check-schema] migration(s) NOT applied: ${result.missingMigrations.join(", ")}`
        : "",
      result.missingObjects.length
        ? `[db:check-schema] object(s) missing: ${result.missingObjects
            .map((o) => `${requiredObjectKey(o)} (from ${o.migration})`)
            .join(", ")}`
        : "",
      `[db:check-schema] apply: ${result.migrationsToApply.join(", ") || "(see above)"}`,
      "[db:check-schema] This check is read-only; nothing was changed.",
      "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  return opts.warnOnly ? 0 : 1;
}

/** Deploy-time entry point: honours the documented SKIP_SCHEMA_CHECK override. */
export async function schemaCheckGate(): Promise<number> {
  if (process.env.SKIP_SCHEMA_CHECK === "1") {
    console.warn(
      "[db:check-schema] WARNING: SKIP_SCHEMA_CHECK=1 — the deploy-time schema gate is DISABLED for this release. " +
        "Anything in db/migrations that has not been applied will fail in front of the owner instead of here."
    );
    return 0;
  }
  return await runSchemaCheck({
    warnOnly: process.env.SCHEMA_CHECK_WARN_ONLY === "1",
  });
}

// Run directly: `bun db/schemaCheck.ts`
if (import.meta.main) {
  schemaCheckGate()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error("[db:check-schema] could not complete the check:", err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
