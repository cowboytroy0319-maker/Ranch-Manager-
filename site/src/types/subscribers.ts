// ============================================================================
// Ranch Manager Pro — Email signup types (shared client + server). JSON-safe.
// ============================================================================
/** Result of a subscribeEmail call. `ok:false` means invalid input or the
 * database is unconfigured; the server never throws. */
export type SubscribeResult =
  | { ok: true; status: "subscribed" | "already-subscribed" }
  | { ok: false };
