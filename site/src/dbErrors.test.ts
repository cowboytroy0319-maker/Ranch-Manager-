// ============================================================================
// Ranch Manager Pro — DB error firewall + deployment-mode database selection
// regression tests (bun test, LOCAL Postgres only, never the owner's Neon).
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_preview bun test src/dbErrors.test.ts
//
// Guarantees under test:
//   • Database selection is keyed off the explicit APP_ENV deployment mode
//     ("production" | "preview") — NEVER presence of PREVIEW_DATABASE_URL:
//     – production (or unset/any other value) → DATABASE_URL ONLY, even if
//       PREVIEW_DATABASE_URL is accidentally present;
//     – preview → PREVIEW_DATABASE_URL ONLY, and fails CLOSED (undefined) if
//       it is missing/blank — never falls back to DATABASE_URL.
//   • A database-originated failure (missing relation, constraint violation)
//     NEVER surfaces its raw message to a caller/handler:
//     – production mode → the generic customer-safe message (preview message NEVER)
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
import {
  closeDb,
  isDatabaseConfigured,
  isPreviewEnvironment,
  resolveDatabaseUrl,
  sql,
} from "~/db";
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

// ---------------------------------------------------------------------------
// Env-var helpers. `setMode` is the single source of truth for the mode the
// app sees; `withEnv` snapshots + restores APP_ENV / PREVIEW_DATABASE_URL so a
// pure selection test can never leak state into a later DB-backed test.
// ---------------------------------------------------------------------------
type Mode = "production" | "preview" | "local";

const setMode = (mode: Mode): void => {
  if (mode === "preview") {
    process.env.APP_ENV = "preview";
    // The preview scratch DB is the SAME local cluster in this suite (both
    // DATABASE_URL and PREVIEW_DATABASE_URL point at 127.0.0.1) so the firewall
    // tests can run real queries; the SELECTION is what's under test, not the
    // host.
    process.env.PREVIEW_DATABASE_URL = url;
  } else if (mode === "production") {
    process.env.APP_ENV = "production";
    delete process.env.PREVIEW_DATABASE_URL;
  } else {
    delete process.env.APP_ENV; // local dev: unset
    delete process.env.PREVIEW_DATABASE_URL;
  }
};

const withEnv = (fn: () => void): void => {
  const appEnv = process.env.APP_ENV;
  const preview = process.env.PREVIEW_DATABASE_URL;
  try {
    fn();
  } finally {
    if (appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnv;
    if (preview === undefined) delete process.env.PREVIEW_DATABASE_URL;
    else process.env.PREVIEW_DATABASE_URL = preview;
  }
};

let savedAppEnv: string | undefined;
let savedPreviewUrl: string | undefined;

beforeAll(async () => {
  savedAppEnv = process.env.APP_ENV;
  savedPreviewUrl = process.env.PREVIEW_DATABASE_URL;
  setMode("production"); // default: behave as the LIVE/production environment
  await runMigrations(); // idempotent
});

afterAll(async () => {
  if (savedAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = savedAppEnv;
  if (savedPreviewUrl === undefined) delete process.env.PREVIEW_DATABASE_URL;
  else process.env.PREVIEW_DATABASE_URL = savedPreviewUrl;
  await closeDb();
});

describe("deployment-mode database selection — APP_ENV is the explicit switch", () => {
  test("isPreviewEnvironment() keys off APP_ENV (exact match, trimmed), never PREVIEW_DATABASE_URL", () => {
    withEnv(() => {
      // production → false even if PREVIEW_DATABASE_URL is accidentally present
      process.env.APP_ENV = "production";
      process.env.PREVIEW_DATABASE_URL = "postgresql://user:password@preview-host:5432/preview_scratch?sslmode=require";
      expect(isPreviewEnvironment()).toBe(false);

      // unset → false
      delete process.env.APP_ENV;
      expect(isPreviewEnvironment()).toBe(false);

      // any other value → false
      process.env.APP_ENV = "staging";
      expect(isPreviewEnvironment()).toBe(false);

      // "preview" with surrounding whitespace → true (trimmed)
      process.env.APP_ENV = "  preview  ";
      expect(isPreviewEnvironment()).toBe(true);

      // exact "preview" → true
      process.env.APP_ENV = "preview";
      expect(isPreviewEnvironment()).toBe(true);
    });
  });

  test("a. APP_ENV=production + DATABASE_URL set + PREVIEW_DATABASE_URL absent → DATABASE_URL", () => {
    withEnv(() => {
      process.env.APP_ENV = "production";
      delete process.env.PREVIEW_DATABASE_URL;
      expect(resolveDatabaseUrl()).toBe(url);
    });
  });

  test("b. APP_ENV=production + DATABASE_URL set + PREVIEW_DATABASE_URL accidentally present → still DATABASE_URL", () => {
    withEnv(() => {
      process.env.APP_ENV = "production";
      process.env.PREVIEW_DATABASE_URL = "postgresql://user:password@preview-host:5432/preview_scratch?sslmode=require";
      expect(resolveDatabaseUrl()).toBe(url);
    });
  });

  test("c. APP_ENV=preview + PREVIEW_DATABASE_URL set + DATABASE_URL present → PREVIEW_DATABASE_URL only", () => {
    withEnv(() => {
      const previewUrl = "postgresql://user:password@preview-host:5432/preview_scratch?sslmode=require";
      process.env.APP_ENV = "preview";
      process.env.PREVIEW_DATABASE_URL = previewUrl;
      expect(resolveDatabaseUrl()).toBe(previewUrl);
      expect(resolveDatabaseUrl()).not.toBe(url);
    });
  });

  test("d. APP_ENV=preview + PREVIEW_DATABASE_URL missing + DATABASE_URL present → undefined (fails closed)", () => {
    withEnv(() => {
      process.env.APP_ENV = "preview";
      delete process.env.PREVIEW_DATABASE_URL;
      expect(resolveDatabaseUrl() === undefined).toBe(true); // fails closed, never DATABASE_URL
    });
  });

  test("isDatabaseConfigured reflects the resolved URL (DATABASE_URL set → true in production)", () => {
    withEnv(() => {
      process.env.APP_ENV = "production";
      delete process.env.PREVIEW_DATABASE_URL;
      expect(isDatabaseConfigured()).toBe(true);
    });
  });
});

describe("db error firewall — PRODUCTION mode (APP_ENV=production, preview message NEVER)", () => {
  test("missing relation → generic safe message, SQLSTATE preserved", async () => {
    setMode("production");
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
    setMode("production");
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
    setMode("production");
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
    setMode("production");
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

describe("db error firewall — PREVIEW mode (APP_ENV=preview)", () => {
  test("missing relation → EXACTLY the preview message", async () => {
    setMode("preview");
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
    setMode("preview");
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
