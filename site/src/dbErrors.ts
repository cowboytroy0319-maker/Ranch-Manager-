/**
 * DB error firewall — the single choke point that keeps raw PostgreSQL /
 * driver errors out of the UI.
 *
 * Every query in the app runs through the guarded client in `src/db.ts`, which
 * funnels any rejected query through `sanitizeDbError` here. Two things matter:
 *
 * 1. A raw database error must NEVER reach a user. Today's handlers pass
 *    `err.message` straight through (e.g. `err instanceof Error ? err.message :
 *    ...`), so a postgres.js `PostgresError` leaks its raw message — the exact
 *    "relation "restock_log" does not exist" the owner saw on the preview when
 *    migration 0018 had not been applied. We rewrite those to customer-safe
 *    text before any handler ever sees them.
 *
 * 2. The rewritten message depends on the environment:
 *    • PREVIEW (PREVIEW_DATABASE_URL set): any DB failure surfaces the exact
 *      customer-safe message  "This preview is being prepared. Please try
 *      again shortly."  — the preview DB is disposable and by definition
 *      "being prepared" whenever it is missing schema or unreachable.
 *    • LIVE (no PREVIEW_DATABASE_URL): the preview message must NEVER appear;
 *      DB failures surface the same generic customer-safe wording the codebase
 *      already uses elsewhere ("We couldn't complete that right now. Please
 *      try again.").
 *    • App-thrown customer-safe errors (validation messages, "That hay stack
 *      no longer exists.", INVENTORY_BELOW_ZERO_ERROR, auth errors, …) are NOT
 *      database errors and pass through completely untouched, so existing
 *      product error behavior is unchanged.
 *
 * The raw technical detail (SQLSTATE code + original message) is logged
 * server-side only, once, at this layer — handler-level console.error calls
 * then log the sanitized error.
 */

/** Exact customer-safe message for preview DB failures. Do not reword. */
export const PREVIEW_PENDING_MESSAGE =
  "This preview is being prepared. Please try again shortly.";

/** Customer-safe generic wording for DB failures outside the preview
 * environment — same wording the codebase already uses for DB-down states. */
export const GENERIC_DB_ERROR_MESSAGE =
  "We couldn't complete that right now. Please try again.";

/** True when this deployment runs as the PREVIEW environment, per the
 * convention documented in src/db.ts: the preview deployment sets
 * PREVIEW_DATABASE_URL (its disposable scratch database); the live deployment
 * never does. */
export const isPreviewEnvironment = (): boolean => {
  const v = process.env.PREVIEW_DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
};

/** SQLSTATE is exactly 5 chars: 2-digit class + 3 alphanumerics (42P01,
 * 23505, 08006, …). Anything else with a `code` property is not a server
 * SQL error and is left alone. */
const SQLSTATE_RE = /^[0-9][0-9][A-Z0-9]{3}$/;

/** postgres.js driver-level failure codes (connection refused/closed, socket,
 * auth, unsupported message) — see node_modules/postgres/src/errors.js. */
const DRIVER_CODE_RE =
  /^(CONNECTION_|AUTH_|MESSAGE_NOT_SUPPORTED|ERR_SOCKET|ECONN|ENOTFOUND|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR)/;

/** True only for errors that originate from the Postgres driver or server.
 * Plain app Errors (no SQLSTATE / driver code, no connection-failure shape)
 * return false and keep their original message — this is what preserves the
 * product's existing customer-safe error behavior. */
export const isDatabaseError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  if (err.name === "PostgresError") return true; // every server-side SQL error
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    if (SQLSTATE_RE.test(code)) return true;
    if (DRIVER_CODE_RE.test(code)) return true;
  }
  // Connection failures that surface as plain Errors (no useful code):
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|connection (refused|terminated|closed)|the connection is closed|Connection ended/i.test(
    err.message
  );
};

/** Replace a DB-originated error with the environment-appropriate
 * customer-safe message, logging the technical detail server-side only.
 * The sanitized error preserves:
 *   • `.code` — the original SQLSTATE / driver code, so programmatic branching
 *     (app code that classifies DB failures) keeps working;
 *   • `.rawDbMessage` — the ORIGINAL technical message, for server-side logic
 *     and logs only. Handlers must keep sending only `.message` to clients. */
export const sanitizeDbError = (err: unknown): Error => {
  const original = err instanceof Error ? err : undefined;
  const code = original ? (original as { code?: unknown }).code : undefined;
  // Server-side only: full technical detail for the operator's logs.
  console.error(
    `[db] database error${code ? ` (code=${String(code)})` : ""}: ${
      original ? `${original.name}: ${original.message}` : String(err)
    }`
  );
  const safe = new Error(
    isPreviewEnvironment() ? PREVIEW_PENDING_MESSAGE : GENERIC_DB_ERROR_MESSAGE
  ) as Error & { code?: string; rawDbMessage?: string };
  if (typeof code === "string") safe.code = code;
  if (original) safe.rawDbMessage = original.message;
  return safe;
};
