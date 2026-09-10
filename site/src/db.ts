import postgres from "postgres";
import {
  GENERIC_DB_ERROR_MESSAGE,
  isDatabaseError,
  isPreviewEnvironment,
  sanitizeDbError,
} from "./dbErrors";

export { isPreviewEnvironment };

/**
 * Server-only handle to the team's Postgres database, over the standard wire
 * protocol (postgres.js — a lightweight client). Resolved lazily (per call,
 * not at module load) so the site still builds and serves before a database is
 * connected — the error only surfaces if a query actually runs without a
 * connection string.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code):
 *
 *   const getPosts = createServerFn().handler(async () => {
 *     const rows = await sql()`select id, title, created_at from posts`;
 *     // Coerce non-primitive columns (timestamps / dates come back as JS Dates)
 *     // to strings before returning to the client, or React will refuse to
 *     // render them:
 *     return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
 *   });
 *
 * ============================================================================
 * PREVIEW vs. LIVE DATABASE SELECTION
 * ============================================================================
 * The platform serves the preview ("working site") and the live site from the
 * SAME build bundle — there is no build-time or request-time signal in the app
 * itself that can tell them apart (the bundle contains neither NODE_ENV nor a
 * host allowlist, and `sql()` is a process-wide singleton, not request-scoped).
 * The one reliable lever is per-deployment environment variables:
 *
 *   • LIVE:  DATABASE_URL = the production Neon string. PREVIEW_DATABASE_URL
 *     must NOT be set. Nothing below changes production behavior in any way.
 *   • PREVIEW: DATABASE_URL may still be present, plus PREVIEW_DATABASE_URL
 *     pointing at a DISPOSABLE scratch database (its own Neon project — never
 *     production data). Whenever PREVIEW_DATABASE_URL is set, sql() uses it.
 *   • Local dev: set DATABASE_URL only — behavior is exactly as before.
 *
 * Why presence-of-var is the switch (instead of host detection): both
 * environments run the identical bundle, env vars are the only per-deployment
 * configuration the platform offers, and it fails safe — a deployment without
 * the variable cannot possibly be redirected anywhere. The owner adds
 * PREVIEW_DATABASE_URL to the preview deployment only; see
 * docs/PREVIEW_ENVIRONMENT.md.
 *
 * The client returned by sql() is GUARDED: any database-originated failure is
 * rewritten by src/dbErrors.ts to a customer-safe message before a handler
 * ever sees it (preview → "This preview is being prepared. Please try again
 * shortly."), with the technical detail logged server-side only. `rawSql()`
 * returns the same underlying client unguarded, for operator tooling
 * (migrations/seeding) where technical error text is the point.
 */

/** Env var the owner sets on the PREVIEW deployment to point it at a
 * disposable database. Never set it on the live deployment. */
export const PREVIEW_ENV_VAR = "PREVIEW_DATABASE_URL";

const databaseUrl = (): string | undefined => {
  const preview = process.env.PREVIEW_DATABASE_URL?.trim();
  if (preview) return preview; // preview deployment → its scratch database
  return process.env.DATABASE_URL?.trim() || undefined;
};

/** The raw (unguarded) pooled client. Operator tooling only. */
export const rawSql = (): postgres.Sql => {
  if (client) return client;
  const url = databaseUrl();
  if (!url) {
    // This error can reach the client through handler catch blocks that pass
    // err.message through, so keep it customer-safe; the technical detail is
    // logged server-side only.
    console.error(
      isPreviewEnvironment()
        ? `${PREVIEW_ENV_VAR} (and DATABASE_URL) are not set — connect a database before running queries.`
        : "DATABASE_URL is not set — connect a database before running queries."
    );
    throw new Error(GENERIC_DB_ERROR_MESSAGE);
  }
  // Neon (and most hosted Postgres) requires TLS; a local dev Postgres usually
  // doesn't. `prefer` negotiates TLS when the server offers it and falls back
  // to plaintext otherwise, so one client works in both settings. An explicit
  // sslmode in the URL always wins.
  const sslmode = /sslmode=([a-z-]+)/.exec(url)?.[1];
  const ssl =
    sslmode === "disable" ? false : sslmode ? (`${sslmode}` as "require") : "prefer";
  client = postgres(url, {
    ssl,
    max: 5,
    // NOTE: no connect_timeout / idle_timeout — their timer math goes negative
    // on this host (clock-skew between Date.now() and performance.now()), which
    // makes postgres.js abort healthy connection attempts with
    // "TimeoutNegativeWarning". Connections are pooled and long-lived anyway.
    onnotice: () => {},
  });
  return client;
};

let client: postgres.Sql | null = null;
let guardedClient: postgres.Sql | null = null;

/** Wrap a pending query so its rejection (and any `.then`/`.catch` rejection)
 * passes through the firewall before reaching application code. Property
 * access stays untouched, so fragments/nested queries behave identically. */
const guardQuery = <T>(query: T): T =>
  new Proxy(query as object, {
    get(target, prop) {
      if (prop === "then") {
        const realThen = (target as unknown as Promise<unknown>).then.bind(target);
        return (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown
        ) =>
          realThen(onFulfilled, (e: unknown) => {
            const safe = isDatabaseError(e) ? sanitizeDbError(e) : (e as Error);
            if (typeof onRejected === "function") return onRejected(safe);
            throw safe;
          });
      }
      return Reflect.get(target, prop, target);
    },
  }) as T;

/** Rewrite any database-originated error to its customer-safe form; leave
 * app-thrown errors (validation, friendly product messages) untouched. */
const guardError = (err: unknown): unknown =>
  isDatabaseError(err) ? sanitizeDbError(err) : err;

/** The app's guarded client: every tagged-template query and every
 * `begin(...)` transaction has its rejections sanitized (a `begin` callback's
 * inner transaction errors all propagate through `begin`'s promise, so this
 * covers `tx.*` queries too). */
export const sql = (): postgres.Sql => {
  if (guardedClient) return guardedClient;
  const raw = rawSql();
  guardedClient = new Proxy(raw, {
    get(target, prop) {
      if (prop === "begin") {
        // begin(cb) | begin(options, cb) — errors from inside the callback
        // (including every tx.* query) reject begin's promise.
        return async (...args: unknown[]) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (target.begin as any)(...args);
          } catch (err) {
            throw guardError(err);
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    apply(target, _thisArg, args) {
      const result = Reflect.apply(target as unknown as (...a: unknown[]) => unknown, target, args);
      // Tagged-template calls return a PendingQuery (a real Promise) whose
      // rejection is the DB error; helper calls return fragments (not
      // thenables) and are passed through untouched.
      return result instanceof Promise ? guardQuery(result) : result;
    },
  }) as unknown as postgres.Sql;
  return guardedClient;
};

/** True when a connection string is present (lets the UI render a clear
 * "database not configured" state instead of surfacing a raw error). */
export const isDatabaseConfigured = (): boolean => Boolean(databaseUrl());

/** Close the pooled connection (used by the db scripts; server code never ends it). */
export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    guardedClient = null;
  }
};
