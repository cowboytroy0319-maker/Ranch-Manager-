// ============================================================================
// Ranch Manager Pro — server-side entitlement helpers (re-export surface)
// ----------------------------------------------------------------------------
// Server modules import hasComplimentaryAccess / checkSubscriptionEntitlement
// from here (or from ./passwordResetServer directly). There is NO client
// import of this module — entitlement checks run server-side only, inside
// createServerFn handlers. Documented here so future paywall code has one
// obvious entry point to consult.
// ============================================================================
export { hasComplimentaryAccess, checkSubscriptionEntitlement } from "./passwordResetServer";
