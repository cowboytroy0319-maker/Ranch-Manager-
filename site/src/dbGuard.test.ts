// ============================================================================
// Deployment-mode DATABASE GUARD tests (bun test) — pure environment logic, no
// database connection, so this file runs anywhere (CI included).
//
// Both directions are exercised, including every deliberate misconfiguration
// the owner asked to be refused:
//
//   PREVIEW direction   APP_ENV=preview with
//     • PREVIEW_DATABASE_URL missing/blank          → PREVIEW_DATABASE_URL_MISSING
//     • preview target == production target, whole
//       identity host+port+database                 → PREVIEW_TARGET_EQUALS_PRODUCTION
//     • preview pointing at a production-marked /
//       hosted (Neon, "prod…") host                 → PREVIEW_TARGET_EQUALS_PRODUCTION
//       (a mere SHARED HOST is NOT a refusal — see
//        "SAME host, DIFFERENT database (the CI pair)")
//     • a preview URL that cannot be parsed         → PREVIEW_DATABASE_URL_UNPARSEABLE
//   PRODUCTION direction  APP_ENV unset/anything-else with
//     • PREVIEW_ENV_EXPECTED set                    → PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW
//     • DATABASE_URL on a preview-marked db name    → PRODUCTION_DB_IS_PREVIEW
//     • DATABASE_URL == PREVIEW_DATABASE_URL target → PRODUCTION_DB_IS_PREVIEW
//
// Plus the OPERATOR guard (db/migrate.ts, db/seed.ts): a production-marked
// target (hosted/Neon host or "prod" name) is refused unless the command line
// carries an explicit --allow-production, and a misconfigured preview can never
// be overridden by a flag.
// ============================================================================
import { describe, expect, test } from "bun:test";
import { GENERIC_DB_ERROR_MESSAGE, PREVIEW_PENDING_MESSAGE } from "./dbErrors";
import {
  assertOperatorTargetSafe,
  evaluateDatabaseGuard,
  evaluateOperatorTarget,
  isPreviewMarkedDbName,
  isProductionMarkedTarget,
  parseDbTarget,
  refusalMessage,
  targetKey,
} from "./dbGuard";

const NEON = "postgresql://neondb_owner:redacted@ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL_PREVIEW = "postgresql://preview_app:redacted@127.0.0.1:5432/ranch_preview";
const LOCAL_CI = "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci";

/** A synthetic environment — the guard takes a plain object, so no test needs
 * to touch (or leak into) the real process.env. */
const env = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ ...vars }) as NodeJS.ProcessEnv;

describe("db target parsing — identities only, never a password", () => {
  test("parses user/host/port/dbname and drops the password", () => {
    const t = parseDbTarget(LOCAL_PREVIEW)!;
    expect(t.user).toBe("preview_app");
    expect(t.host).toBe("127.0.0.1");
    expect(t.port).toBe("5432");
    expect(t.dbname).toBe("ranch_preview");
    expect(t.id).toBe("preview_app@127.0.0.1:5432/ranch_preview");
    expect(JSON.stringify(t)).not.toContain("redacted");
  });

  test("defaults the port when the URL omits it, and returns null for junk", () => {
    expect(parseDbTarget("postgresql://u:p@db.example.com/ranch")!.port).toBe("5432");
    expect(parseDbTarget("")).toBeNull();
    expect(parseDbTarget("   ")).toBeNull();
    expect(parseDbTarget("not-a-url")).toBeNull();
    expect(parseDbTarget(undefined)).toBeNull();
  });

  test("targetKey ignores the user but keeps host:port/dbname", () => {
    const a = parseDbTarget("postgresql://alice:pw@Host.Example:5432/Ranch");
    const b = parseDbTarget("postgresql://bob:pw@host.example:5432/ranch");
    expect(targetKey(a)).toBe(targetKey(b));
  });

  test("preview-marked db names and production-marked targets", () => {
    expect(isPreviewMarkedDbName("ranch_preview")).toBe(true);
    expect(isPreviewMarkedDbName("ranch_ci_preview")).toBe(true);
    expect(isPreviewMarkedDbName("preview")).toBe(true);
    expect(isPreviewMarkedDbName("ranch_ci")).toBe(false);
    expect(isPreviewMarkedDbName("ranch_prodshape")).toBe(false);

    expect(isProductionMarkedTarget(parseDbTarget(NEON))).toBe(true);
    expect(isProductionMarkedTarget(parseDbTarget("postgres://postgres@127.0.0.1:5432/ranch_prodshape"))).toBe(true);
    expect(isProductionMarkedTarget(parseDbTarget(LOCAL_CI))).toBe(false);
    expect(isProductionMarkedTarget(parseDbTarget(LOCAL_PREVIEW))).toBe(false);
    expect(isProductionMarkedTarget(null)).toBe(false);
  });
});

describe("PREVIEW direction — APP_ENV=preview", () => {
  test("a correct preview config passes: preview URL only, production untouched", () => {
    const g = evaluateDatabaseGuard(
      env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: LOCAL_PREVIEW, DATABASE_URL: NEON, PREVIEW_ENV_EXPECTED: "1" })
    );
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
    expect(g.mode).toBe("preview");
    expect(g.modeSource).toBe("APP_ENV=preview");
    expect(g.urlSource).toBe("PREVIEW_DATABASE_URL");
    expect(g.effectiveUrl).toBe(LOCAL_PREVIEW);
    expect(g.target?.id).toBe("preview_app@127.0.0.1:5432/ranch_preview");
    expect(g.productionHost).toBe("ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech");
    expect(g.equalsProductionTarget).toBe(false);
  });

  test("MISSING preview URL → refused, never a fallback to DATABASE_URL", () => {
    const g = evaluateDatabaseGuard(env({ APP_ENV: "preview", DATABASE_URL: NEON }));
    expect(g.refusal?.rule).toBe("PREVIEW_DATABASE_URL_MISSING");
    expect(g.ok).toBe(false);
    expect(g.effectiveUrl === undefined).toBe(true);
    expect(g.effectiveUrl).not.toBe(NEON);
  });

  test("BLANK preview URL (spaces) → refused as missing", () => {
    const g = evaluateDatabaseGuard(env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: "   ", DATABASE_URL: NEON }));
    expect(g.refusal?.rule).toBe("PREVIEW_DATABASE_URL_MISSING");
    expect(g.effectiveUrl === undefined).toBe(true);
  });

  test("unparseable preview URL → refused (no guessing at a target)", () => {
    const g = evaluateDatabaseGuard(env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: "preview-db", DATABASE_URL: NEON }));
    expect(g.refusal?.rule).toBe("PREVIEW_DATABASE_URL_UNPARSEABLE");
    expect(g.effectiveUrl === undefined).toBe(true);
  });

  test("preview target IDENTICAL to the production target → refused", () => {
    const g = evaluateDatabaseGuard(
      env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: NEON, DATABASE_URL: NEON })
    );
    expect(g.refusal?.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
    expect(g.ok).toBe(false);
    expect(g.effectiveUrl === undefined).toBe(true); // ← the query can never run
  });

  test("preview target equal to production under a DIFFERENT user is still refused", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgresql://preview_app@ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech/neondb",
        DATABASE_URL: NEON,
      })
    );
    expect(g.refusal?.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
  });

  test("preview on a PRODUCTION-MARKED host, different db → refused", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgresql://preview_app:pw@ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech/ranch_preview",
        DATABASE_URL: NEON,
      })
    );
    expect(g.refusal?.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
    expect(g.effectiveUrl === undefined).toBe(true);
    // The refusal says WHY: a hosted/production-marked host, not a db-name match.
    expect(g.refusal?.detail).toContain("hosted");
  });

  // -------------------------------------------------------------------------
  // The whole-target comparison (CI blocked on this). Both CI databases live on
  // 127.0.0.1: a host-only comparison could not tell `ranch_ci` from
  // `ranch_preview` and refused a perfectly safe preview. The guard must now
  // compare host + port + database, while refusing EXACTLY as loudly as before
  // everything that could reach production.
  // -------------------------------------------------------------------------
  test("SAME host, DIFFERENT database (the CI pair) → ALLOWED", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_preview",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
      })
    );
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
    expect(g.effectiveUrl).toBe("postgres://postgres:postgres@127.0.0.1:5432/ranch_preview");
    expect(g.equalsProductionTarget).toBe(false);
    // …and the two scratch targets are still identifiable as different.
    expect(targetKey(g.target)).toBe("127.0.0.1:5432/ranch_preview");
    expect(targetKey(g.productionTarget)).toBe("127.0.0.1:5432/ranch_ci");
  });

  test("SAME host AND database, different PORT → ALLOWED (port is part of the target)", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgres://postgres:pw@127.0.0.1:5433/ranch",
        DATABASE_URL: "postgres://postgres:pw@127.0.0.1:5432/ranch",
      })
    );
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
  });

  test("IDENTICAL full target (host:port/database) → STILL REFUSED", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
      })
    );
    expect(g.refusal?.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
    expect(g.effectiveUrl === undefined).toBe(true);
    expect(g.ok).toBe(false);
  });

  test("a local preview whose database IS the production one (same host, same db, different user) → refused", () => {
    const g = evaluateDatabaseGuard(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgres://preview_app:pw@127.0.0.1:5432/ranch_ci",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
      })
    );
    expect(g.refusal?.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
    expect(g.ok).toBe(false);
  });

  test("the operator guard (db:seed / db:migrate) still refuses the CI pair's preview target — no bypass flag needed", () => {
    // The seed must keep working on 127.0.0.1:5432/ranch_preview with
    // DATABASE_URL pointing at the CI scratch database.
    const check = evaluateOperatorTarget(
      env({
        APP_ENV: "preview",
        PREVIEW_ENV_EXPECTED: "1",
        PREVIEW_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_preview",
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
      })
    );
    expect(check.safe).toBe(true);
    expect(check.rule).toBeNull();
    // …and it still refuses the same host when the database IS production's.
    const unsafe = evaluateOperatorTarget(
      env({
        APP_ENV: "preview",
        PREVIEW_DATABASE_URL: "postgres://preview_app:pw@ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech/neondb",
        DATABASE_URL: NEON,
      })
    );
    expect(unsafe.safe).toBe(false);
    expect(unsafe.overridable).toBe(false); // ← not even --allow-production clears this
  });
});

describe("PRODUCTION direction — APP_ENV absent or anything but preview", () => {
  test("a normal production config passes (DATABASE_URL, no preview interference)", () => {
    const g = evaluateDatabaseGuard(env({ APP_ENV: "production", DATABASE_URL: NEON }));
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
    expect(g.mode).toBe("production");
    expect(g.urlSource).toBe("DATABASE_URL");
    expect(g.effectiveUrl).toBe(NEON);
  });

  test("APP_ENV=false-ish values are NOT preview (only the exact word is)", () => {
    for (const value of ["", "production", "Production", "staging", "preview-prod", "false"]) {
      const g = evaluateDatabaseGuard(env({ APP_ENV: value || undefined, DATABASE_URL: NEON }));
      expect(g.mode).toBe("production");
    }
    expect(evaluateDatabaseGuard(env({ APP_ENV: "  preview  ", PREVIEW_DATABASE_URL: LOCAL_PREVIEW, DATABASE_URL: NEON })).mode).toBe("preview");
  });

  test("PREVIEW_ENV_EXPECTED set but APP_ENV missing → refused (the hole that reached production)", () => {
    const g = evaluateDatabaseGuard(env({ PREVIEW_ENV_EXPECTED: "1", DATABASE_URL: NEON }));
    expect(g.refusal?.rule).toBe("PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW");
    expect(g.ok).toBe(false);
    expect(g.effectiveUrl === undefined).toBe(true);
    expect(g.previewEnvExpected).toBe(true);
  });

  test("PREVIEW_ENV_EXPECTED set but APP_ENV=production → refused too", () => {
    const g = evaluateDatabaseGuard(env({ PREVIEW_ENV_EXPECTED: "1", APP_ENV: "production", DATABASE_URL: NEON }));
    expect(g.refusal?.rule).toBe("PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW");
  });

  test("PREVIEW_ENV_EXPECTED=0 is not 'expected' — config passes", () => {
    const g = evaluateDatabaseGuard(env({ PREVIEW_ENV_EXPECTED: "0", DATABASE_URL: NEON }));
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
    expect(g.previewEnvExpected).toBe(false);
  });

  test("DATABASE_URL on a preview-marked db name → refused (never serve scratch data as production)", () => {
    const g = evaluateDatabaseGuard(env({ DATABASE_URL: LOCAL_PREVIEW }));
    expect(g.refusal?.rule).toBe("PRODUCTION_DB_IS_PREVIEW");
    expect(g.effectiveUrl === undefined).toBe(true);
  });

  test("DATABASE_URL == PREVIEW_DATABASE_URL target (even without a 'preview' name) → refused", () => {
    const g = evaluateDatabaseGuard(
      env({
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_ci",
        PREVIEW_DATABASE_URL: "postgres://preview_app:pw@127.0.0.1:5432/ranch_ci",
      })
    );
    expect(g.refusal?.rule).toBe("PRODUCTION_DB_IS_PREVIEW");
    expect(g.equalsProductionTarget).toBe(true);
  });

  test("no database configured at all → no refusal (the app renders 'not configured')", () => {
    const g = evaluateDatabaseGuard(env({}));
    expect(g.refusal).toBeNull();
    expect(g.ok).toBe(true);
    expect(g.effectiveUrl === undefined).toBe(true);
    expect(g.urlSource).toBe("none");
  });
});

describe("refusal wording — customer-safe, environment-appropriate", () => {
  test("preview refusals use the preview wording, production never does", () => {
    expect(refusalMessage(true)).toBe(PREVIEW_PENDING_MESSAGE);
    expect(refusalMessage(false)).toBe(GENERIC_DB_ERROR_MESSAGE);
    expect(refusalMessage(false)).not.toBe(PREVIEW_PENDING_MESSAGE);
  });

  test("no refusal detail ever contains something that looks like a password", () => {
    const cases: NodeJS.ProcessEnv[] = [
      env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: NEON, DATABASE_URL: NEON }),
      env({ APP_ENV: "preview", DATABASE_URL: NEON }),
      env({ PREVIEW_ENV_EXPECTED: "1", DATABASE_URL: NEON }),
      env({ DATABASE_URL: LOCAL_PREVIEW }),
    ];
    for (const c of cases) {
      const g = evaluateDatabaseGuard(c);
      expect(g.refusal?.detail ?? "").not.toContain("redacted");
      expect(g.refusal?.detail ?? "").not.toContain("://");
    }
  });
});

describe("OPERATOR guard (db:migrate / db:seed)", () => {
  test("a bare migrate in a shell that inherits the production Neon URL is REFUSED", () => {
    const check = evaluateOperatorTarget(env({ DATABASE_URL: NEON }));
    expect(check.safe).toBe(false);
    expect(check.rule).toBe("PRODUCTION_MARKED_TARGET");
    expect(check.overridable).toBe(true);
    expect(check.reason ?? "").toContain("env -u DATABASE_URL");
  });

  test("preview work against the LOCAL scratch database is allowed", () => {
    const check = evaluateOperatorTarget(
      env({ APP_ENV: "preview", PREVIEW_ENV_EXPECTED: "1", PREVIEW_DATABASE_URL: LOCAL_PREVIEW })
    );
    expect(check.safe).toBe(true);
    expect(check.target?.id).toBe("preview_app@127.0.0.1:5432/ranch_preview");
  });

  test("the CI/local case (plain local DATABASE_URL, no APP_ENV) is still allowed", () => {
    expect(evaluateOperatorTarget(env({ DATABASE_URL: LOCAL_CI })).safe).toBe(true);
  });

  test("a production-mode DATABASE_URL on the preview database is refused (not overridable)", () => {
    const check = evaluateOperatorTarget(
      env({ DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/ranch_preview" })
    );
    expect(check.safe).toBe(false);
    expect(check.rule).toBe("PRODUCTION_DB_IS_PREVIEW");
    expect(check.overridable).toBe(false);
  });

  test("a misconfigured preview is refused and NOT overridable by a flag", () => {
    const check = evaluateOperatorTarget(env({ APP_ENV: "preview", DATABASE_URL: NEON }));
    expect(check.safe).toBe(false);
    expect(check.rule).toBe("PREVIEW_DATABASE_URL_MISSING");
    expect(check.overridable).toBe(false);
  });

  test("preview routed at the production target is refused and not overridable", () => {
    const check = evaluateOperatorTarget(env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: NEON, DATABASE_URL: NEON }));
    expect(check.rule).toBe("PREVIEW_TARGET_EQUALS_PRODUCTION");
    expect(check.overridable).toBe(false);
  });

  test("no target at all → refused as nothing to run against", () => {
    const check = evaluateOperatorTarget(env({}));
    expect(check.safe).toBe(false);
    expect(check.rule).toBeNull();
    expect(check.overridable).toBe(false);
  });

  test("--allow-production is required to pass a production-marked target", () => {
    const prod = env({ DATABASE_URL: NEON });
    expect(assertOperatorTargetSafe(prod, ["bun", "db/migrate.ts"], "test-tool")).toBe(false);
    expect(assertOperatorTargetSafe(prod, ["bun", "db/migrate.ts", "--allow-production"], "test-tool")).toBe(true);
    // …but a flag never clears a misconfiguration
    const broken = env({ APP_ENV: "preview", PREVIEW_DATABASE_URL: NEON, DATABASE_URL: NEON });
    expect(assertOperatorTargetSafe(broken, ["bun", "db/migrate.ts", "--allow-production"], "test-tool")).toBe(false);
  });
});

describe("resolveDatabaseUrl — the runtime refusal path (process.env)", () => {
  const withEnv = <T,>(vars: Record<string, string | undefined>, fn: () => T): T => {
    const saved = { ...process.env };
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      return fn();
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };

  test("preview with a missing URL resolves to undefined (fail closed, no fallback)", async () => {
    const { resolveDatabaseUrl } = await import("~/db");
    withEnv({ APP_ENV: "preview", PREVIEW_DATABASE_URL: undefined, DATABASE_URL: NEON }, () => {
      // Deliberately NOT `toBeUndefined()`: Bun's typings do not declare that
      // matcher (tsc: TS2551), and the CI typecheck fails on any error that is
      // not in site/tsc-baseline.txt. Comparing to `undefined` is equivalent.
      expect(resolveDatabaseUrl() === undefined).toBe(true);
    });
  });

  test("preview pointed at production THROWS the customer-safe message and runs no query", async () => {
    const { resolveDatabaseUrl } = await import("~/db");
    withEnv({ APP_ENV: "preview", PREVIEW_DATABASE_URL: NEON, DATABASE_URL: NEON }, () => {
      expect(() => resolveDatabaseUrl()).toThrow(PREVIEW_PENDING_MESSAGE);
    });
  });

  test("production pointed at preview data THROWS the generic message (never the preview one)", async () => {
    const { resolveDatabaseUrl } = await import("~/db");
    withEnv({ APP_ENV: undefined, PREVIEW_DATABASE_URL: undefined, DATABASE_URL: LOCAL_PREVIEW }, () => {
      expect(() => resolveDatabaseUrl()).toThrow(GENERIC_DB_ERROR_MESSAGE);
      try {
        resolveDatabaseUrl();
      } catch (err) {
        expect((err as Error).message).not.toContain(PREVIEW_PENDING_MESSAGE);
      }
    });
  });

  test("PREVIEW_ENV_EXPECTED without preview mode throws (production is never used silently)", async () => {
    const { resolveDatabaseUrl } = await import("~/db");
    withEnv({ APP_ENV: undefined, PREVIEW_ENV_EXPECTED: "1", DATABASE_URL: NEON }, () => {
      expect(() => resolveDatabaseUrl()).toThrow(GENERIC_DB_ERROR_MESSAGE);
    });
  });
});
