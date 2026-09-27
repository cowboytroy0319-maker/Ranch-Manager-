/**
 * ============================================================================
 * DEPLOYMENT-MODE DATABASE GUARD — the two refusals that keep the preview
 * deployment off production, and production off the scratch database.
 * ============================================================================
 *
 * `src/db.ts` picks the connection string from the explicit deployment-mode
 * switch `APP_ENV` ("preview" → `PREVIEW_DATABASE_URL`, anything else →
 * `DATABASE_URL`). That selection alone is not enough: a *misconfigured* preview
 * still reaches production (e.g. `PREVIEW_DATABASE_URL` left pointing at the
 * production host, or `APP_ENV` missing on a preview deployment so the code
 * silently takes the production branch). This module adds the two directions of
 * refusal the owner asked for, and every refusal means **no query is executed**
 * — there is no silent fallback, ever.
 *
 * PREVIEW direction (APP_ENV === "preview") — refuse when:
 *   1. `PREVIEW_DATABASE_URL` is missing/blank                → PREVIEW_DATABASE_URL_MISSING
 *   2. the preview target `host:port/dbname` is identical to
 *      `DATABASE_URL`'s target, or its host equals the
 *      production host                                        → PREVIEW_TARGET_EQUALS_PRODUCTION
 *   3. `PREVIEW_ENV_EXPECTED` is set but `APP_ENV !== "preview"`
 *      (the hole that let the preview reach production)        → PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW
 *
 * PRODUCTION direction (APP_ENV absent or anything but "preview") — refuse when:
 *   4. `DATABASE_URL` points at the preview database (same target as
 *      `PREVIEW_DATABASE_URL`, or a preview-marked db name such as
 *      `ranch_preview` / `*_preview`)                          → PRODUCTION_DB_IS_PREVIEW
 *
 * The preview deployment gets its three variables from the local gitignored
 * `.env.local`, loaded by `vite.config.ts` **only** on the dev/working-site
 * server (`command === "serve"`) — see docs/PREVIEW_ENVIRONMENT.md. The built
 * live site never executes that path and stays on `DATABASE_URL`, byte for byte.
 *
 * Operator tooling (`db/migrate.ts`, `db/seed.ts`) additionally refuses a
 * production-marked target (a Neon/production host, or a target named
 * "prod…") unless an explicit `--allow-production` flag is passed — see
 * `evaluateOperatorTarget()` below. That is the guard against running a bare
 * `bun run db:migrate` in a shell that exports the production `DATABASE_URL`.
 *
 * This module performs NO I/O and NEVER reads or returns a password: only
 * `user@host:port/dbname` identities, hosts and rule names are ever exposed.
 */
import { GENERIC_DB_ERROR_MESSAGE, PREVIEW_PENDING_MESSAGE } from "./dbErrors";

/** Env var that names the deployment mode: "production" | "preview". It is the
 * ONLY switch for which database to use — never presence of PREVIEW_DATABASE_URL. */
export const APP_ENV_VAR = "APP_ENV";

/** Env var the preview deployment sets to point at the disposable scratch DB. */
export const PREVIEW_ENV_VAR = "PREVIEW_DATABASE_URL";

/** Env var set ONLY by the local preview env file. Its presence on a deployment
 * that is NOT in preview mode means the preview's mode switch went missing —
 * exactly the misconfiguration that silently sent the preview to production. */
export const PREVIEW_ENV_EXPECTED_VAR = "PREVIEW_ENV_EXPECTED";

/** Env var holding the LIVE/production connection string. */
export const DATABASE_URL_VAR = "DATABASE_URL";

/** The four guard rules, in evaluation order. */
export type GuardRule =
  | "PREVIEW_DATABASE_URL_MISSING"
  | "PREVIEW_DATABASE_URL_UNPARSEABLE"
  | "PREVIEW_TARGET_EQUALS_PRODUCTION"
  | "PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW"
  | "PRODUCTION_DB_IS_PREVIEW";

/** A parsed connection target. The password is NEVER parsed or stored. */
export type DbTarget = {
  user: string;
  host: string;
  port: string;
  dbname: string;
  /** `user@host:port/dbname` — safe to log/display (no password). */
  id: string;
};

export type GuardRefusal = { rule: GuardRule; detail: string };

export type DbGuardResult = {
  /** Explicit deployment mode, per APP_ENV (trimmed, exact match). */
  mode: "preview" | "production";
  /** Which variable supplied the mode — "APP_ENV=preview" or "APP_ENV unset". */
  modeSource: string;
  /** Which variable supplied the connection string actually used. */
  urlSource: "PREVIEW_DATABASE_URL" | "DATABASE_URL" | "none";
  /** The connection string the app would use (undefined when unusable/refused). */
  effectiveUrl: string | undefined;
  /** Parsed identity of the effective target (no password). */
  target: DbTarget | null;
  /** Production env var as configured (never assumed absent). */
  productionUrl: string | undefined;
  /** Parsed identity of DATABASE_URL (also the "what could I fall back to" target). */
  productionTarget: DbTarget | null;
  /** Production host name only (safe to display), or null when unset. */
  productionHost: string | null;
  /** preview target == production target (host:port/dbname), when both known. */
  equalsProductionTarget: boolean;
  /** PREVIEW_ENV_EXPECTED is set (non-blank). */
  previewEnvExpected: boolean;
  /** The refusal, when the configuration must not be used. */
  refusal: GuardRefusal | null;
  /** True when the configuration is usable. */
  ok: boolean;
};

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && v.length > 0 ? v : undefined;
};

/** Parse a Postgres connection string into host/user/db identity. The password
 * is discarded immediately — it is never returned, logged or compared. */
export const parseDbTarget = (url: string | undefined | null): DbTarget | null => {
  const raw = trimmed(url ?? undefined);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const dbname = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!host || !dbname) return null;
  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username || "");
  return { user, host, port, dbname, id: `${user}@${host}:${port}/${dbname}` };
};

/** `host:port/dbname` — the target identity the owner's rules compare (the user
 * is deliberately excluded, so `preview_app@…/ranch_preview` still collides
 * with `postgres@…/ranch_preview`). */
export const targetKey = (target: DbTarget | null): string =>
  target ? `${target.host}:${target.port}/${target.dbname.toLowerCase()}` : "";

export const sameTarget = (a: DbTarget | null, b: DbTarget | null): boolean =>
  Boolean(a && b) && targetKey(a) === targetKey(b);

/** A database name that marks scratch/preview data: `ranch_preview`,
 * `ranch_ci_preview`, `preview`, `…_preview_ci`. */
export const isPreviewMarkedDbName = (dbname: string): boolean =>
  /(^|[._-])preview([._-]|$)/i.test(dbname);

/** A host or database name that marks a PRODUCTION target: a hosted Neon
 * endpoint, or a name containing "prod"/"production" (e.g. `neondb`,
 * `ep-x.pooler.c-12.us-east-1.aws.neon.tech`, `ranch_prodshape`). Used by the
 * operator-tooling guard so a bare `bun run db:migrate` cannot touch production. */
const PRODUCTION_NAME_RE = /(^|[._-])prod/i;

export const isProductionMarkedHost = (host: string): boolean =>
  /(^|\.)neon\.tech$/i.test(host) || PRODUCTION_NAME_RE.test(host);

export const isProductionMarkedTarget = (target: DbTarget | null): boolean =>
  Boolean(target) && (isProductionMarkedHost(target!.host) || PRODUCTION_NAME_RE.test(target!.dbname));

const truthy = (value: string | undefined): boolean => {
  const v = trimmed(value)?.toLowerCase();
  return v !== undefined && v !== "0" && v !== "false" && v !== "no";
};

/**
 * Evaluate BOTH guard directions against an environment (defaults to
 * `process.env`, but any plain object works — that is how the rules are unit
 * tested, including every deliberate misconfiguration).
 */
export const evaluateDatabaseGuard = (env: NodeJS.ProcessEnv = process.env): DbGuardResult => {
  const appEnvRaw = trimmed(env[APP_ENV_VAR]);
  const isPreview = appEnvRaw === "preview";
  const previewUrl = trimmed(env[PREVIEW_ENV_VAR]);
  const productionUrl = trimmed(env.DATABASE_URL);
  const previewExpected = truthy(env[PREVIEW_ENV_EXPECTED_VAR]);

  const productionTarget = parseDbTarget(productionUrl);
  const previewTarget = parseDbTarget(previewUrl);

  const base = {
    mode: (isPreview ? "preview" : "production") as "preview" | "production",
    modeSource: appEnvRaw ? `${APP_ENV_VAR}=${appEnvRaw}` : `${APP_ENV_VAR} unset`,
    productionUrl,
    productionTarget,
    productionHost: productionTarget?.host ?? null,
    previewEnvExpected: previewExpected,
  };

  if (isPreview) {
    let refusal: GuardRefusal | null = null;
    if (!previewUrl) {
      refusal = {
        rule: "PREVIEW_DATABASE_URL_MISSING",
        detail: `${APP_ENV_VAR}=preview but ${PREVIEW_ENV_VAR} is missing/blank — refusing to fall back to ${DATABASE_URL_VAR}.`,
      };
    } else if (!previewTarget) {
      refusal = {
        rule: "PREVIEW_DATABASE_URL_UNPARSEABLE",
        detail: `${PREVIEW_ENV_VAR} is not a usable Postgres connection string — refusing to guess a target.`,
      };
    } else if (sameTarget(previewTarget, productionTarget)) {
      refusal = {
        rule: "PREVIEW_TARGET_EQUALS_PRODUCTION",
        detail: `preview target ${previewTarget.id} is the SAME target as ${DATABASE_URL_VAR} (${productionTarget?.id}) — refusing to run preview traffic against the production database.`,
      };
    } else if (
      productionTarget &&
      previewTarget.host === productionTarget.host
    ) {
      refusal = {
        rule: "PREVIEW_TARGET_EQUALS_PRODUCTION",
        detail: `preview target host ${previewTarget.host} matches the production host ${productionTarget.host} — refusing to run preview traffic against the production host.`,
      };
    }
    return {
      ...base,
      urlSource: previewUrl ? PREVIEW_ENV_VAR : "none",
      effectiveUrl: refusal ? undefined : previewUrl,
      target: previewTarget,
      equalsProductionTarget: sameTarget(previewTarget, productionTarget),
      refusal,
      ok: refusal === null,
    };
  }

  // Production direction: APP_ENV missing or anything other than "preview".
  let refusal: GuardRefusal | null = null;
  if (previewExpected) {
    refusal = {
      rule: "PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW",
      detail: `${PREVIEW_ENV_EXPECTED_VAR} is set but ${APP_ENV_VAR} is ${appEnvRaw ? `"${appEnvRaw}"` : "unset"} — this deployment declares itself a preview but is not in preview mode; refusing to fall through to the production database.`,
    };
  } else if (productionTarget && isPreviewMarkedDbName(productionTarget.dbname)) {
    refusal = {
      rule: "PRODUCTION_DB_IS_PREVIEW",
      detail: `${DATABASE_URL_VAR} points at a preview-marked database (${productionTarget.id}) while ${APP_ENV_VAR} is ${appEnvRaw ? `"${appEnvRaw}"` : "unset"} — refusing to serve scratch data as production.`,
    };
  } else if (productionTarget && sameTarget(productionTarget, previewTarget)) {
    refusal = {
      rule: "PRODUCTION_DB_IS_PREVIEW",
      detail: `${DATABASE_URL_VAR} is the same target as ${PREVIEW_ENV_VAR} (${productionTarget.id}) while ${APP_ENV_VAR} is ${appEnvRaw ? `"${appEnvRaw}"` : "unset"} — refusing to serve scratch data as production.`,
    };
  }
  return {
    ...base,
    urlSource: productionUrl ? DATABASE_URL_VAR : "none",
    effectiveUrl: refusal ? undefined : productionUrl,
    target: productionTarget,
    equalsProductionTarget: sameTarget(productionTarget, previewTarget),
    refusal,
    ok: refusal === null,
  };
};

/** The customer-safe message a refusal surfaces. Mirrors the DB error firewall
 * (src/dbErrors.ts): the preview wording appears only when this deployment IS
 * the preview; production only ever sees the generic wording. */
export const refusalMessage = (preview: boolean): string =>
  preview ? PREVIEW_PENDING_MESSAGE : GENERIC_DB_ERROR_MESSAGE;

/** Loud, once-per-rule server-side log for a refusal. It carries rule + target
 * identities only — never a password, never a connection string. */
const loggedRules = new Set<string>();
export const logGuardRefusal = (guard: DbGuardResult, context = "db-guard"): void => {
  if (!guard.refusal) return;
  const line =
    `[${context}] DATABASE GUARD REFUSED — rule=${guard.refusal.rule} mode=${guard.mode} ` +
    `(${guard.modeSource}) target=${guard.target?.id ?? "none"} ` +
    `productionHost=${guard.productionHost ?? "none"} :: ${guard.refusal.detail}`;
  if (loggedRules.has(guard.refusal.rule)) return;
  loggedRules.add(guard.refusal.rule);
  console.error(line);
};

// ---------------------------------------------------------------------------
// Operator tooling guard (db/migrate.ts, db/seed.ts)
// ---------------------------------------------------------------------------
export type OperatorTargetCheck = {
  /** True when this target may be written to. */
  safe: boolean;
  rule: GuardRule | "PRODUCTION_MARKED_TARGET" | null;
  /** One-line reason, or null when safe. */
  reason: string | null;
  /** True when `--allow-production` clears this refusal (a misconfiguration
   * refusal never can — the configuration itself has to be fixed). */
  overridable: boolean;
  target: DbTarget | null;
};

/**
 * Decide whether an OPERATOR command (migrate/seed) may use the target this
 * environment resolves to. Refuses:
 *   • any guard refusal above (missing preview URL, preview==production, preview
 *     env expected but mode missing, production pointing at preview data) — NOT
 *     overridable; and
 *   • a production-marked target (Neon host / "prod" name) — overridable only by
 *     passing `--allow-production` explicitly.
 */
export const evaluateOperatorTarget = (
  env: NodeJS.ProcessEnv = process.env
): OperatorTargetCheck => {
  const guard = evaluateDatabaseGuard(env);
  if (guard.refusal) {
    return {
      safe: false,
      rule: guard.refusal.rule,
      reason: guard.refusal.detail,
      overridable: false,
      target: guard.target,
    };
  }
  const target = guard.target;
  if (!target) {
    return {
      safe: false,
      rule: null,
      reason: `no database target resolved (${guard.modeSource}) — set ${PREVIEW_ENV_VAR} (preview) or DATABASE_URL.`,
      overridable: false,
      target: null,
    };
  }
  if (isProductionMarkedTarget(target)) {
    return {
      safe: false,
      rule: "PRODUCTION_MARKED_TARGET",
      reason:
        `target ${target.id} looks like a PRODUCTION database (hosted/Neon host or a "prod" name). ` +
        `Run preview work as: env -u DATABASE_URL APP_ENV=preview PREVIEW_DATABASE_URL=... bun run db:migrate`,
      overridable: true,
      target,
    };
  }
  return { safe: true, rule: null, reason: null, overridable: false, target };
};

/**
 * CLI-side wrapper for the operator guard. Returns true to proceed; otherwise
 * prints a loud, multi-line refusal (identities only) and returns false so the
 * caller can set a non-zero exit code WITHOUT having connected.
 */
export const assertOperatorTargetSafe = (
  env: NodeJS.ProcessEnv,
  argv: string[],
  tool: string
): boolean => {
  const allowProduction = argv.includes("--allow-production");
  const check = evaluateOperatorTarget(env);
  const modeSource = evaluateDatabaseGuard(env).modeSource;
  if (check.safe) {
    console.log(`[${tool}] target ${check.target?.id ?? "none"} (mode ${modeSource})`);
    return true;
  }
  if (check.overridable && allowProduction) {
    console.warn(
      `[${tool}] WARNING: running against a production-marked target ${check.target?.id} because --allow-production was passed.`
    );
    return true;
  }
  console.error(
    [
      "",
      `[${tool}] REFUSED — ${check.rule ?? "NO_TARGET"}`,
      `[${tool}] ${check.reason}`,
      check.overridable
        ? `[${tool}] If this really is intended: re-run with --allow-production.`
        : `[${tool}] This refusal cannot be overridden by a flag — fix the ${APP_ENV_VAR}/${PREVIEW_ENV_VAR} configuration first.`,
      `[${tool}] Nothing was connected to and no statement was executed.`,
      "",
    ].join("\n")
  );
  return false;
};
