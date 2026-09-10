// ============================================================================
// Ranch Manager Pro — DB error firewall + preview/live database selection
// regression tests (bun test, LOCAL Postgres only, never the owner's Neon).
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_preview bun test src/dbErrors.test.ts
//
// Guarantees under test:
//   • A database-originated failure (missing relation, constraint violation)
//     NEVER surfaces its raw message to a caller/handler:
//     – live mode  → the generic customer-safe message (preview message NEVER)
//     – preview mode → EXACTLY "This preview is being prepared. Please try
//       again shortly."
//   • The SQLSTATE code is preserved on the sanitized error for programmatic
//     branching.
//   • App-thrown customer-safe errors pass through the guard COMPLETELY
//     unchanged (existing product error behavior is not weakened).
//   • The same underlying failure thrown inside a `begin(...)` transaction is
//     masked too (the guarded client wraps begin's promise).
// ============================================================================
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../db/migrate";
import { closeDb, isDatabaseConfigured, isPreviewEnvironment, sql } from "~/db";
import {
  GENERIC_DB_ERROR_MESSAGE,
  PREVIEW_PENDING_MESSAGE,
  isDatabaseError,
} from "./dbErrors";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "dbErrors.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

let savedPreviewUrl: string | undefined;
const setPreviewMode = (on: boolean): void => {
  if (on) process.env.PREVIEW_DATABASE_URL = url;
  else delete process.env.PREVIEW_DATABASE_URL;
};

beforeAll(async () => {
  savedPreviewUrl = process.env.PREVIEW_DATABASE_URL;
  setPreviewMode(false); // default: behave as the LIVE environment
  await runMigrations(); // idempotent
});

afterAll(async () => {
  if (savedPreviewUrl === undefined) delete process.env.PREVIEW_DATABASE_URL;
  else process.env.PREVIEW_DATABASE_URL = savedPreviewUrl;
  await closeDb();
});

describe("preview/live database selection", () => {
  test("presence/absence of PREVIEW_DATABASE_URL is the environment signal", () => {
    setPreviewMode(false);
    expect(isPreviewEnvironment()).toBe(false);
    setPreviewMode(true);
    expect(isPreviewEnvironment()).toBe(true);
    setPreviewMode(false);
    expect(isPreviewEnvironment()).toBe(false);
    // whitespace-only is not "set"
    process.env.PREVIEW_DATABASE_URL = "   ";
    expect(isPreviewEnvironment()).toBe(false);
    delete process.env.PREVIEW_DATABASE_URL;
  });

  test("isDatabaseConfigured reflects DATABASE_URL (live dev unchanged)", () => {
    expect(isDatabaseConfigured()).toBe(true); // DATABASE_URL is set in this suite
  });
});

describe("db error firewall — LIVE mode (no PREVIEW_DATABASE_URL)", () => {
  test("missing relation → generic safe message, SQLSTATE preserved", async () => {
    setPreviewMode(false);
    let caught: Error | undefined;
    try {
      await sql()`SELECT * FROM no_such_table_dberrors_test`;
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toBe(GENERIC_DB_ERROR_MESSAGE);
    expect(caught?.message).not.toContain("does not exist");
    expect((caught as Error & { code?: string }).code).toBe("42P01");
  });

  test("unique-violation (duplicate) → generic safe message, SQLSTATE preserved", async () => {
    setPreviewMode(false);
    const name = `dberrors-dup-${Date.now()}`;
    await sql()`INSERT INTO schema_migrations (name) VALUES (${name})`;
    let caught: Error | undefined;
    try {
      await sql()`INSERT INTO schema_migrations (name) VALUES (${name})`;
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toBe(GENERIC_DB_ERROR_MESSAGE);
    expect(caught?.message).not.toContain("duplicate key");
    expect((caught as Error & { code?: string }).code).toBe("23505");
  });

  test("app-thrown customer-safe errors pass through UNCHANGED (inside begin)", async () => {
    setPreviewMode(false);
    let caught: Error | undefined;
    try {
      await sql().begin(async () => {
        throw new Error("Pick a category for this expense.");
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toBe("Pick a category for this expense.");
  });

  test("isDatabaseError classifies driver/server errors but not app errors", () => {
    setPreviewMode(false);
    const appErr = new Error("Pick a category for this expense.");
    expect(isDatabaseError(appErr)).toBe(false);
    expect(isDatabaseError(new Error("ENOENT: no file"))).toBe(false);
    const pgLike = Object.assign(new Error('relation "x" does not exist'), { code: "42P01" });
    pgLike.name = "PostgresError";
    expect(isDatabaseError(pgLike)).toBe(true);
    expect(isDatabaseError(Object.assign(new Error("write ECONNREFUSED 1.2.3.4:5432"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseError(undefined)).toBe(false);
  });
});

describe("db error firewall — PREVIEW mode (PREVIEW_DATABASE_URL set)", () => {
  test("missing relation → EXACTLY the preview message", async () => {
    setPreviewMode(true);
    let caught: Error | undefined;
    try {
      await sql()`SELECT * FROM no_such_table_dberrors_test`;
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toBe(PREVIEW_PENDING_MESSAGE);
    expect((caught as Error & { code?: string }).code).toBe("42P01");
  });

  test("failure inside a begin() transaction → preview message too", async () => {
    setPreviewMode(true);
    let caught: Error | undefined;
    try {
      await sql().begin(async (tx) => {
        await tx`SELECT * FROM no_such_table_dberrors_tx`;
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toBe(PREVIEW_PENDING_MESSAGE);
  });
});
