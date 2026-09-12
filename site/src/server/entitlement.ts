// ============================================================================
// Ranch Manager Pro — server-side entitlement helpers (re-export surface)
// ----------------------------------------------------------------------------
// Server modules import hasComplimentaryAccess / checkSubscriptionEntitlement
// from here. There is NO client import of this module — entitlement checks
// run server-side only, inside createServerFn handlers. Documented here so
// future paywall code has one obvious entry point to consult.
//
// Complimentary access is granted explicitly per operation via
// operations.is_complimentary (default false), set ONLY by an audited UPDATE
// for a specific operation id (paper trail in operation_entitlements). It
// bypasses ONLY future subscription/paywall checks — never login,
// requireAuth, or operation_id data isolation.
// ============================================================================
import type postgres from "postgres";

export type EntitlementDb = postgres.Sql;

/**
 * hasComplimentaryAccess — true only when operations.is_complimentary is set
 * for the given operation. Fail closed: unknown operation, missing column,
 * or any DB error means no complimentary access.
 */
export async function hasComplimentaryAccess(
  db: EntitlementDb,
  operationId: number
): Promise<boolean> {
  try {
    if (!Number.isInteger(operationId)) return false;
    const [row] = await db<[{ is_complimentary: boolean }]>`SELECT is_complimentary
      FROM operations WHERE id = ${operationId} LIMIT 1`;
    return row?.is_complimentary === true;
  } catch {
    return false;
  }
}

/**
 * checkSubscriptionEntitlement — the single entitlement-check entry point for
 * future paywall code. `subscribed` is not wired to Stripe yet (always
 * false); `complimentary` reflects the owner-granted flag.
 */
export async function checkSubscriptionEntitlement(
  db: EntitlementDb,
  operationId: number
): Promise<{ complimentary: boolean; subscribed: boolean }> {
  const complimentary = await hasComplimentaryAccess(db, operationId);
  return { complimentary, subscribed: false };
}
