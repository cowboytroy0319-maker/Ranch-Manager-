/**
 * ============================================================================
 * PRODUCTION PREFLIGHT for `0018_product_blocker.sql` — READ-ONLY, EXITS NON-ZERO.
 *
 *   bun run db:preflight-0018
 *
 * WHY THIS EXISTS (the defect it closes)
 *   The 2026-09-30 production run of 0018 failed on its FIRST statement and
 *   rolled back completely. The preflight that preceded it was a list of `psql`
 *   SELECTs a HUMAN had to read and diff by eye. That is how the one condition
 *   that mattered slipped through: `ALTER TABLE expenses DROP CONSTRAINT IF
 *   EXISTS expenses_category_check` is NAME-ONLY, so if production's category
 *   constraint carries any other name the DROP is a silent no-op, the first
 *   `UPDATE` is rejected by the still-active legacy CHECK (23514), and the run
 *   fails again — while `psql -f` still exits 0 and every printed row looks
 *   plausible.
 *
 *   This script turns every condition the run depends on into an assertion with
 *   an exit code. Nothing here is left to a careful reader.
 *
 * WHAT IT ASSERTS (each one FAILS the process when it does not hold)
 *   env       the process is NOT resolving the preview database (a preflight
 *             that silently read the preview would "pass" and prove nothing)
 *   readonly  the session itself is read-only, so this can never write
 *   migrations   `schema_migrations` holds exactly the pre-run set:
 *             0001…0017 + 0019 + 0020, and NOT 0018 (19 rows)
 *   work-absent  the four 0018 objects and the three 0018 columns do NOT exist
 *   category-check  a CHECK constraint NAMED `expenses_category_check` exists on
 *             `expenses` — name-only is the whole problem, so the name matters
 *   check-shape  that constraint's `pg_get_constraintdef` is a plain
 *             `category = ANY (ARRAY[...])` membership test over EXACTLY the six
 *             legacy values (0007's allow-list) — a renamed, re-written or
 *             re-ordered constraint is caught here
 *   one-check  no OTHER constraint on `expenses` restricts `category` to a value
 *             list (an unrelated extra CHECK is reported, not failed — it does
 *             not affect this run)
 *   values    every stored `expenses.category` is one of the six legacy values,
 *             and the column is still NOT NULL
 *   version   PostgreSQL is 11 or newer (below 11, statements 16/17 would
 *             rewrite every `pastures` row)
 *   locks     no other session is holding a long-running transaction
 *   rollback  `pastures.size_acres` holds no NULL (the documented inverse
 *             re-adds NOT NULL, which fails on a NULL row)
 *
 * SAFETY
 *   * READ-ONLY, and provably so: every check runs inside ONE transaction the
 *     server opens `READ ONLY` (`SET TRANSACTION READ ONLY`, read back and
 *     printed as the `readonly` check). PostgreSQL itself rejects any write, so
 *     a future edit to this file cannot touch the owner's data. Every statement
 *     is a SELECT or a catalogue lookup. No DDL, no writes, no migration is ever
 *     applied.
 *   * Like `db/schemaCheck.ts` it is deliberately NOT blocked by the operator
 *     guard: refusing to LOOK at production is how an un-migrated release
 *     reaches the owner. It never writes, so looking is safe.
 *   * It prints the target identity (`user@host:port/dbname`) — never a password,
 *     never a connection string.
 *   * Exit codes: 0 = every check passed; 1 = at least one check failed (do NOT
 *     run the migration); 2 = no usable target (nothing was connected to).
 * ============================================================================
 */
import { closeDb, databaseGuard, rawSql } from "../src/db";

/** The migration this preflight gates. */
export const TARGET_MIGRATION = "0018_product_blocker.sql";

/** The six values `0007_expenses.sql` allowed, in the order 0007 lists them. */
export const LEGACY_CATEGORY_VALUES = [
  "feed",
  "vet_health",
  "maintenance",
  "insurance",
  "fuel",
  "other",
] as const;

/** The four objects 0018 creates; all must be ABSENT before the run. */
export const TARGET_OBJECTS = [
  "restock_log",
  "pasture_activities",
  "livestock_movements",
  "expenses_source_once_uniq",
] as const;

/** The three columns 0018 adds to `expenses`; all must be ABSENT before the run. */
export const TARGET_COLUMNS = ["paid_by", "source_type", "source_id"] as const;

/** The name the migration drops and re-adds. Name-only DROP is the known trap. */
export const CATEGORY_CONSTRAINT_NAME = "expenses_category_check";

export type PreflightCheck = {
  /** Stable id — the failing ids are what the operator reads. */
  id: string;
  /** One line: what a runnable database looks like. */
  requirement: string;
  ok: boolean;
  /** What this database actually shows (secret-free, human-readable). */
  observed: string;
};

export type PreflightReport = {
  ok: boolean;
  checks: PreflightCheck[];
  failures: PreflightCheck[];
  /** Target identity, never a connection string. */
  target: string;
  modeSource: string;
};

// ---------------------------------------------------------------------------
// Pure helpers — the decision logic, testable without a database.
// ---------------------------------------------------------------------------

/**
 * Parse a `pg_get_constraintdef` string for the expenses category allow-list.
 *
 *   CHECK ((category = ANY (ARRAY['feed'::text, 'vet_health'::text, …])))
 *   CHECK (category = ANY (ARRAY['feed', 'vet_health']::text[]))
 *   CHECK (category IN ('feed', 'vet_health'))
 *
 * Returns the constrained column and the set of allowed values, or `null` when
 * the definition is NOT a simple "one column must be one of these constants"
 * test. `null` is a FAILURE for the caller, never a pass: an unrecognised shape
 * is exactly the case a human eye was supposed to catch.
 */
export function parseCategoryValueList(
  definition: string
): { column: string; values: string[] } | null {
  // `NOT VALID` / `NO INHERIT` are properties of the constraint, not part of the
  // allow-list it enforces — a NOT VALID copy of the same definition is the same
  // definition for this run (the migration drops it either way).
  const def = definition.replace(/\s+/g, " ").replace(/\s+(NOT VALID|NO INHERIT)$/i, "").trim();

  // `col = ANY (ARRAY[...])` — the shape 0007 and 0018 both produce.
  const anyMatch = /^check\s*\(\s*\(?\s*"?(\w+)"?\s*=\s*any\s*\(\s*array\s*\[([\s\S]*?)\]\s*(?:::[\w[\]]+)?\s*\)\s*\)?\s*\)$/i.exec(
    def
  );
  // `col IN (...)` — an equivalent spelling a future edit could introduce.
  const inMatch = /^check\s*\(\s*\(?\s*"?(\w+)"?\s+in\s*\(([^)]*)\)\s*\)?\s*\)$/i.exec(def);
  const match = anyMatch ?? inMatch;
  if (!match) return null;
  const [, column, listText] = match;
  const literals = listText.match(/'(?:[^']|'')*'/g);
  if (!literals || literals.length === 0) return null;
  const values = literals.map((l) => l.slice(1, -1).replace(/''/g, "'"));
  return { column, values };
}

const sameValueSets = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/** `16.15 (Ubuntu …)` → 16. Non-numeric/unknown → null (a failure for the caller). */
export function parseMajorVersion(version: string | null): number | null {
  const m = /^(\d+)/.exec((version ?? "").trim());
  return m ? Number(m[1]) : null;
}

export const PRE_MIGRATION_SET = [
  "0001_livestock.sql",
  "0002_feed.sql",
  "0003_pasture.sql",
  "0004_equipment.sql",
  "0005_subscription_events.sql",
  "0006_app_settings.sql",
  "0007_expenses.sql",
  "0008_page_views.sql",
  "0009_subscribers.sql",
  "0010_employees.sql",
  "0011_tax_exemptions.sql",
  "0012_livestock_core.sql",
  "0013_animals_ranch_scope.sql",
  "0014_auth_users_operations.sql",
  "0015_tasks_projects.sql",
  "0016_operation_onboarding.sql",
  "0017_livestock_imports.sql",
  "0019_owner_complimentary_access.sql",
  "0020_password_reset.sql",
] as const;

// ---------------------------------------------------------------------------
// The check runner
// ---------------------------------------------------------------------------

type Sql = ReturnType<typeof rawSql>;

type RawReading = {
  readOnly: string | null;
  migrations: string[] | null;
  objects: Record<string, boolean> | null;
  columns: { name: string; isNullable: boolean }[] | null;
  checks: { name: string; definition: string }[] | null;
  histogram: { category: string | null; n: number }[] | null;
  serverVersion: string | null;
  longTransactions: number | null;
  sizeAcresNulls: number | null;
};

/** Collect every reading INSIDE one read-only transaction. Errors never throw: a
 *  failed query becomes `null` and the dependent check fails with the error text
 *  — a preflight that crashes is a preflight nobody runs.
 *
 *  The transaction is opened `READ ONLY`, which the server itself enforces: any
 *  write this script (or a future edit to it) attempts is rejected by PostgreSQL
 *  before it can touch the owner's data. `transaction_read_only` is read back
 *  inside that same transaction and printed as the `readonly` check. */
async function collect(db: Sql, errors: string[], longTransactionSeconds: number): Promise<RawReading> {
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  return await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const rows = <T>(q: Promise<unknown>): Promise<T> => q as Promise<T>;

    // Session safety FIRST — everything after this point is read-only by
    // construction, even if a future edit accidentally adds a write.
    await safe("set read-only", async () => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      return true;
    });

    const readOnly = await safe("read-only setting", async () => {
      const r = await rows<{ v: string }[]>(
        tx.unsafe("SELECT current_setting('transaction_read_only') AS v")
      );
      return r[0]?.v ?? null;
    });

    const migrations = await safe("schema_migrations", async () => {
      const r = await rows<{ name: string }[]>(tx`SELECT name FROM schema_migrations ORDER BY name`);
      return r.map((x) => x.name);
    });

    const objects = await safe("0018 objects", async () => {
      // The object names are this file's own constants — no user input.
      const values = TARGET_OBJECTS.map((n) => `('${n}')`).join(", ");
      const r = await rows<{ name: string; present: boolean }[]>(
        tx.unsafe(
          `SELECT o.name, to_regclass('public.' || o.name) IS NOT NULL AS present
             FROM (VALUES ${values}) AS o(name) ORDER BY o.name`
        )
      );
      return Object.fromEntries(r.map((x) => [x.name, x.present]));
    });

    const columns = await safe("expenses columns", async () => {
      const r = await tx<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'expenses'
          AND table_schema = ANY(current_schemas(false))
          AND column_name IN ('category', 'paid_by', 'source_type', 'source_id')
        ORDER BY column_name`;
      return r.map((x) => ({ name: x.column_name, isNullable: x.is_nullable === "YES" }));
    });

    const checks = await safe("expenses CHECK constraints", async () => {
      const r = await tx<{ name: string; definition: string }[]>`
        SELECT conname AS name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = to_regclass('expenses') AND contype = 'c'
        ORDER BY conname`;
      return r;
    });

    const histogram = await safe("category histogram", async () => {
      const r = await tx<{ category: string | null; n: number }[]>`
        SELECT category, count(*)::int AS n FROM expenses GROUP BY 1 ORDER BY 1 NULLS FIRST`;
      return r;
    });

    const serverVersion = await safe("server version", async () => {
      const r = await rows<{ v: string }[]>(
        tx.unsafe("SELECT current_setting('server_version') AS v")
      );
      return r[0]?.v ?? null;
    });

    const longTransactions = await safe("open transactions", async () => {
      const r = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE state <> 'idle' AND xact_start IS NOT NULL
          AND datname = current_database()
          AND now() - xact_start > ${`${longTransactionSeconds} seconds`}::interval
          AND pid <> pg_backend_pid()`;
      return r[0]?.n ?? null;
    });

    const sizeAcresNulls = await safe("pastures.size_acres NULLs", async () => {
      const r = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM pastures WHERE size_acres IS NULL`;
      return r[0]?.n ?? null;
    });

    return {
      readOnly,
      migrations,
      objects,
      columns,
      checks,
      histogram,
      serverVersion,
      longTransactions,
      sizeAcresNulls,
    };
  });
}

/** Turn readings into named, pass/fail checks. Pure: no I/O. */
export function evaluatePreflight(
  reading: RawReading,
  opts: { errors: string[]; target: string; modeSource: string; mode: "preview" | "production" }
): PreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (id: string, requirement: string, ok: boolean, observed: string) =>
    checks.push({ id, requirement, ok, observed });

  // 0. The environment must not be resolving the preview database.
  add(
    "env",
    "the process resolves the PRODUCTION target (not APP_ENV=preview / PREVIEW_DATABASE_URL)",
    opts.mode === "production",
    `mode ${opts.mode} (${opts.modeSource}) → ${opts.target}`
  );

  // 1. Session is read-only: nothing below can write.
  add(
    "readonly",
    "the session runs in a READ ONLY transaction (transaction_read_only = on)",
    reading.readOnly === "on",
    `transaction_read_only = ${reading.readOnly ?? "(unknown — the SET or the read-back failed)"}`
  );

  // 2. Query-level faults are failures in their own right (never silent).
  add(
    "queries",
    "every preflight query completed",
    opts.errors.length === 0,
    opts.errors.length ? opts.errors.join(" | ") : "all queries returned"
  );

  // 3. Migration bookkeeping is exactly the pre-run state.
  const applied = reading.migrations;
  const appliedList = applied ?? [];
  const expected = new Set<string>(PRE_MIGRATION_SET);
  const hasTarget = appliedList.includes(TARGET_MIGRATION);
  const missing = PRE_MIGRATION_SET.filter((m) => !appliedList.includes(m));
  const extra = appliedList.filter((m) => !expected.has(m));
  const migrationStateOk =
    applied !== null && !hasTarget && missing.length === 0 && extra.length === 0 && appliedList.length === PRE_MIGRATION_SET.length;
  add(
    "migrations",
    `schema_migrations = exactly the 19 pre-run files (0001…0017 + 0019 + 0020), ${TARGET_MIGRATION} ABSENT`,
    migrationStateOk,
    applied === null
      ? "(query failed — can the preflight read schema_migrations at all?)"
      : `count ${appliedList.length}` +
        (hasTarget ? `; ${TARGET_MIGRATION} IS ALREADY RECORDED AS APPLIED` : "") +
        (missing.length ? `; MISSING ${missing.join(", ")}` : "") +
        (extra.length ? `; UNEXPECTED ${extra.join(", ")}` : "")
  );

  // 4. The four objects and the three columns must be absent.
  const objectsPresent = Object.entries(reading.objects ?? {})
    .filter(([, present]) => present)
    .map(([name]) => name);
  add(
    "objects-absent",
    `the four 0018 objects do not exist (${TARGET_OBJECTS.join(", ")})`,
    reading.objects !== null && objectsPresent.length === 0,
    reading.objects === null
      ? "(query failed)"
      : objectsPresent.length
        ? `ALREADY EXISTS: ${objectsPresent.join(", ")}`
        : "all four absent"
  );

  const cols = reading.columns ?? [];
  const linkColsPresent = cols
    .filter((c) => (TARGET_COLUMNS as readonly string[]).includes(c.name))
    .map((c) => c.name);
  add(
    "columns-absent",
    `the three 0018 columns do not exist on expenses (${TARGET_COLUMNS.join(", ")})`,
    reading.columns !== null && linkColsPresent.length === 0,
    reading.columns === null
      ? "(query failed)"
      : linkColsPresent.length
        ? `ALREADY EXISTS: ${linkColsPresent.join(", ")}`
        : "all three absent"
  );

  // 5. The column the 0018 CHECK is added to must still be NOT NULL (0007).
  const categoryCol = cols.find((c) => c.name === "category");
  add(
    "category-not-null",
    "expenses.category is NOT NULL (so the 12-value CHECK is total and no blank label is reachable)",
    categoryCol !== undefined && categoryCol.isNullable === false,
    categoryCol ? `category is_nullable=${categoryCol.isNullable ? "YES" : "NO"}` : "(expenses.category not found)"
  );

  // 6. The constraint the migration drops must exist UNDER THAT NAME.
  const allChecks = reading.checks ?? [];
  const named = allChecks.find((c) => c.name === CATEGORY_CONSTRAINT_NAME);
  add(
    "category-check-present",
    `a CHECK constraint named "${CATEGORY_CONSTRAINT_NAME}" exists on expenses (the DROP is name-only)`,
    named !== undefined,
    named
      ? `${CATEGORY_CONSTRAINT_NAME} :: ${named.definition}`
      : allChecks.length
        ? `NOT FOUND — expenses carries instead: ${allChecks.map((c) => c.name).join(", ")}`
        : "(no CHECK constraints on expenses at all / query failed)"
  );

  // 7. Its definition must be the legacy six-value membership test.
  const parsed = named ? parseCategoryValueList(named.definition) : null;
  const definitionOk =
    parsed !== null &&
    parsed.column === "category" &&
    sameValueSets(parsed.values, LEGACY_CATEGORY_VALUES);
  add(
    "category-check-shape",
    `"${CATEGORY_CONSTRAINT_NAME}" is a "category = ANY (ARRAY[…])" test over EXACTLY the six legacy values (${LEGACY_CATEGORY_VALUES.join(", ")})`,
    definitionOk,
    named === undefined
      ? "(constraint missing — see category-check-present)"
      : parsed === null
        ? `UNRECOGNISED DEFINITION: ${named.definition}`
        : `column=${parsed.column}; values=${parsed.values.join(", ")}` +
          (/NOT VALID\s*$/i.test(named.definition) ? " (NOT VALID)" : "") +
          (parsed.column !== "category"
            ? " — NOT the category column"
            : sameValueSets(parsed.values, LEGACY_CATEGORY_VALUES)
              ? ""
              : " — does not match the six legacy values")
  );

  // 8. No OTHER constraint may restrict `category` (a renamed twin survives the
  //    DROP and re-breaks the run). An unrelated extra CHECK is reported only.
  const otherCategoryChecks = allChecks.filter((c) => {
    if (c.name === CATEGORY_CONSTRAINT_NAME) return false;
    const p = parseCategoryValueList(c.definition);
    return p !== null && p.column === "category";
  });
  const unrelatedChecks = allChecks
    .filter((c) => c.name !== CATEGORY_CONSTRAINT_NAME && !otherCategoryChecks.includes(c))
    .map((c) => c.name);
  add(
    "no-rival-category-check",
    "no second constraint on expenses restricts the category values (a renamed twin would survive the DROP)",
    reading.checks !== null && otherCategoryChecks.length === 0,
    reading.checks === null
      ? "(query failed)"
      : otherCategoryChecks.length
        ? `RIVAL CONSTRAINT(S): ${otherCategoryChecks.map((c) => c.name).join(", ")}`
        : unrelatedChecks.length
          ? `none (unrelated CHECKs present, harmless for this run: ${unrelatedChecks.join(", ")})`
          : "none"
  );

  // 9. Stored category values must all be inside the legacy six.
  const hist = reading.histogram ?? [];
  const nullRows = hist.filter((r) => r.category === null).reduce((s, r) => s + r.n, 0);
  const outside = hist
    .filter((r) => r.category !== null && !(LEGACY_CATEGORY_VALUES as readonly string[]).includes(r.category))
    .map((r) => `${r.category} (${r.n})`);
  add(
    "category-values",
    `every stored expenses.category is one of the six legacy values (${LEGACY_CATEGORY_VALUES.join(", ")})`,
    reading.histogram !== null && outside.length === 0 && nullRows === 0,
    reading.histogram === null
      ? "(query failed)"
      : `histogram ${hist.map((r) => `${r.category ?? "(NULL)"}=${r.n}`).join(" ")}` +
        (outside.length ? ` — OUTSIDE the legacy six: ${outside.join(", ")}` : "") +
        (nullRows ? ` — ${nullRows} NULL row(s)` : "")
  );

  // 10. Server version — under 11, statements 16/17 rewrite every pastures row.
  const major = parseMajorVersion(reading.serverVersion);
  add(
    "server-version",
    "PostgreSQL server_version >= 11",
    major !== null && major >= 11,
    reading.serverVersion ?? "(unknown)"
  );

  // 11. No competing long transaction (the runner sets no lock_timeout).
  add(
    "no-long-transactions",
    "no other session holds a transaction older than 5 s",
    reading.longTransactions === 0,
    reading.longTransactions === null
      ? "(query failed)"
      : reading.longTransactions === 0
        ? "none"
        : `${reading.longTransactions} long-running session(s) — wait or re-run in a quiet window`
  );

  // 12. The documented rollback re-adds NOT NULL to pastures.size_acres.
  add(
    "rollback-precondition",
    "pastures.size_acres holds no NULL (the documented inverse re-adds NOT NULL)",
    reading.sizeAcresNulls === 0,
    reading.sizeAcresNulls === null ? "(query failed)" : `${reading.sizeAcresNulls} NULL row(s)`
  );

  const failures = checks.filter((c) => !c.ok);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    target: opts.target,
    modeSource: opts.modeSource,
  };
}

/** Run every check against a connection. Read-only; never throws.
 *
 *  `longTransactionSeconds` is the "quiet window" threshold for the
 *  no-competing-transaction check. It defaults to 5 s (the production
 *  requirement); tests pass 0 so the check can be exercised without sleeping. */
export async function runPreflight(
  db: Sql,
  opts: {
    target: string;
    modeSource: string;
    mode: "preview" | "production";
    longTransactionSeconds?: number;
  }
): Promise<PreflightReport> {
  const errors: string[] = [];
  const reading = await collect(db, errors, opts.longTransactionSeconds ?? 5);
  return evaluatePreflight(reading, { ...opts, errors });
}

/** Human-readable, grep-friendly transcript. */
export function formatPreflight(report: PreflightReport): string {
  const lines = [
    `[db:preflight-0018] target ${report.target} (mode ${report.modeSource})`,
    `[db:preflight-0018] read-only preflight for ${TARGET_MIGRATION} — ${report.checks.length} checks`,
  ];
  for (const c of report.checks) {
    lines.push(`[db:preflight-0018] ${c.ok ? "PASS" : "FAIL"} ${c.id}: ${c.requirement}`);
    lines.push(`[db:preflight-0018]        observed: ${c.observed}`);
  }
  if (report.ok) {
    lines.push(`[db:preflight-0018] OK — all ${report.checks.length} checks passed; ${TARGET_MIGRATION} may be run once.`);
  } else {
    lines.push(
      `[db:preflight-0018] REFUSED — ${report.failures.length} of ${report.checks.length} checks FAILED: ` +
        report.failures.map((f) => f.id).join(", ")
    );
    lines.push("[db:preflight-0018] Do NOT run the migration. Nothing was changed by this check.");
  }
  lines.push("");
  return lines.join("\n");
}

export const preflightExitCode = (report: PreflightReport): number => (report.ok ? 0 : 1);

// Run directly: `bun db/preflight0018.ts`
if (import.meta.main) {
  const guard = databaseGuard();
  const target = guard.target?.id ?? "none";
  if (!guard.effectiveUrl || guard.refusal) {
    console.error(
      `[db:preflight-0018] no usable database target (${guard.refusal?.rule ?? "NO_TARGET"}) — ` +
        `set DATABASE_URL (production) or APP_ENV=preview + PREVIEW_DATABASE_URL (preview). Nothing was connected to.`
    );
    process.exitCode = 2;
  } else {
    runPreflight(rawSql(), { target, modeSource: guard.modeSource, mode: guard.mode })
      .then((report) => {
        console.log(formatPreflight(report));
        process.exitCode = preflightExitCode(report);
      })
      .catch((err) => {
        console.error("[db:preflight-0018] could not complete the check:", err);
        process.exitCode = 1;
      })
      .finally(closeDb);
  }
}
