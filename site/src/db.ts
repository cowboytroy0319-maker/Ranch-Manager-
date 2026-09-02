import postgres from "postgres";

/**
 * Server-only handle to the team's Postgres database, over the standard wire
 * protocol (postgres.js — a lightweight client). The connection string comes
 * from `DATABASE_URL` (e.g. the owner's Neon connection string or a local
 * Postgres in dev). Resolved lazily (per call, not at module load) so the site
 * still builds and serves before a database is connected — the error only
 * surfaces if a query actually runs without `DATABASE_URL`.
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
 */

let client: postgres.Sql | null = null;

export const sql = (): postgres.Sql => {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database before running queries."
    );
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

/** True when a connection string is present (lets the UI render a clear
 * "database not configured" state instead of surfacing a raw error). */
export const isDatabaseConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

/** Close the pooled connection (used by the db scripts; server code never ends it). */
export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
};
