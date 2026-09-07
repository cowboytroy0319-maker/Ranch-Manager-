// ============================================================================
// Ranch Manager Pro — shared onboarding UI helpers (client-safe).
// Wires template downloads to the server-side CSV route: a normal GET
// navigation to /templates/<slug>.csv that returns a real attachment download
// (Content-Disposition: attachment) — the Safari/iPhone-compatible path. No
// Blob, no programmatic anchor click, no popups. The auth check happens on the
// server (the rmp_session cookie is validated in the route handler); an
// unauthenticated tap redirects to /login?reason=auth like every protected page.
//
// NOTE: this file is client-safe (no server imports). The "/templates" path is
// the same constant served by src/server/templateDownload.ts at the HTTP layer.
// ============================================================================
import type { TemplateSlug } from "~/types/onboarding";

/** URL prefix for server-side CSV template downloads — must match
 * TEMPLATE_DOWNLOAD_PATH in src/server/templateDownload.ts. */
export const TEMPLATE_DOWNLOAD_PATH = "/templates";

/** The download URL for a template — the server returns a real .csv
 * attachment with filename ranch-<slug>.csv. */
export function templateDownloadUrl(slug: TemplateSlug): string {
  return `${TEMPLATE_DOWNLOAD_PATH}/${slug}.csv`;
}