// ============================================================================
// Ranch Manager Pro — /preview-status data (server-only).
//
// Reports, for the process serving this request: which environment mode it is
// in, which variable supplied that mode, which database it would use (identity
// only: user@host:port/dbname — the password is NEVER read, returned or
// logged), whether that target is the production target, the guard verdict
// (pass / refused + rule), the migration count + latest migration, and the
// branch + commit the preview tree was synced from.
//
// It deliberately reports nothing else. No secrets, no connection strings, no
// table contents, no keys.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { APP_ENV_VAR, PREVIEW_ENV_EXPECTED_VAR, PREVIEW_ENV_VAR, type GuardRule } from "~/dbGuard";
import { databaseGuard, isDatabaseConfigured, sql } from "~/db";

export type PreviewStatusMigrations = {
  count: number | null;
  latest: string | null;
  /** Why the migration numbers are unavailable, when they are. */
  note: string | null;
};

export type PreviewStatusDeployment = {
  branch: string | null;
  commit: string | null;
  shortCommit: string | null;
  syncedAt: string | null;
  /** Random-ish marker written by the sync step: identical on the phone-reachable
   * URL and on the local dev server when both are the same process. */
  marker: string | null;
  source: string;
};

export type PreviewStatus = {
  mode: "preview" | "production";
  modeSource: string;
  urlSource: string;
  previewEnvExpected: boolean;
  /** `user@host:port/dbname` of the database this process would use (no password). */
  previewDatabase: string | null;
  productionHost: string | null;
  productionTargetLabel: string | null;
  equalsProductionTarget: boolean;
  configured: boolean;
  guard: { state: "pass" | "refused"; rule: GuardRule | null; detail: string | null };
  migrations: PreviewStatusMigrations;
  deployment: PreviewStatusDeployment;
};

/** Defence in depth: never let a connection string with credentials leak into a
 * response or a log line, whatever shape an upstream value has. */
const redact = (value: string | null): string | null =>
  value === null ? null : value.replace(/:\/\/[^@\s/]+@/g, "://***@");

const readDeploymentFile = (): PreviewStatusDeployment => {
  const candidates = [
    join(process.cwd(), ".preview-deployment.json"),
    join(process.cwd(), "..", ".preview-deployment.json"),
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const str = (key: string): string | null => {
        const v = parsed[key];
        return typeof v === "string" && v.trim() ? v.trim() : null;
      };
      return {
        branch: str("branch"),
        commit: str("commit"),
        shortCommit: str("shortCommit"),
        syncedAt: str("syncedAt"),
        marker: str("marker"),
        source: file,
      };
    } catch {
      // try the next candidate
    }
  }
  return {
    branch: null,
    commit: null,
    shortCommit: null,
    syncedAt: null,
    marker: null,
    source: "(no .preview-deployment.json in the tree)",
  };
};

const readMigrations = async (): Promise<PreviewStatusMigrations> => {
  try {
    const rows = await sql()<[{ count: number; latest: string | null }]>`
      SELECT count(*)::int AS count,
             (SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1) AS latest
      FROM schema_migrations`;
    return { count: rows[0]?.count ?? 0, latest: rows[0]?.latest ?? null, note: null };
  } catch (err) {
    // Either the guard refused, the database is unreachable, or the schema is
    // missing. The status page must still render, so report it instead of throwing.
    const reason = err instanceof Error ? err.message : String(err);
    return { count: null, latest: null, note: redact(reason) };
  }
};

export const getPreviewStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<PreviewStatus> => {
    const guard = databaseGuard();
    const migrations = await readMigrations();
    return {
      mode: guard.mode,
      modeSource: guard.modeSource,
      urlSource: guard.urlSource,
      previewEnvExpected: guard.previewEnvExpected,
      previewDatabase: guard.mode === "preview" ? (guard.target?.id ?? null) : null,
      productionHost: guard.productionHost,
      productionTargetLabel: guard.mode === "preview" ? null : (guard.target?.id ?? null),
      equalsProductionTarget: guard.equalsProductionTarget,
      configured: isDatabaseConfigured(),
      guard: {
        state: guard.refusal ? "refused" : "pass",
        rule: guard.refusal?.rule ?? null,
        detail: guard.refusal ? redact(guard.refusal.detail) : null,
      },
      migrations,
      deployment: readDeploymentFile(),
    };
  }
);

/** The three variable names this page proves are in play — re-exported so the
 * page never has to hard-code them. */
export const ENV_VAR_NAMES = { APP_ENV_VAR, PREVIEW_ENV_VAR, PREVIEW_ENV_EXPECTED_VAR };
