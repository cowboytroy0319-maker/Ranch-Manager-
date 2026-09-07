// ============================================================================
// Ranch Manager Pro — server-side CSV template download handler (raw HTTP).
//
// Serves GET /templates/<slug>.csv as a REAL HTTP file download (Content-Type
// text/csv; charset=utf-8 + Content-Disposition attachment; filename=
// "ranch-<slug>.csv"), instead of the old client-side Blob + anchor a.click()
// flow which is flaky/blocked on iPhone Safari.
//
// This runs at the HTTP layer (wired into serve.ts and vercel-entry.ts next to
// the /webhook intercept), so there is no TanStack request context: the
// `rmp_session` cookie is read from the raw Request and validated directly
// against the sessions/users tables (SHA-256 token hash + session lookup + the
// user's live membership — the same resolution requireAuth uses, via
// resolveAuthToken in authServer.ts). Unauthenticated requests are redirected
// to /login?reason=auth, matching how the protected app routes behave.
//
// No popups, no external services, no macros, no browser-specific hacks — it is
// a plain, cache-safe GET navigation URL that Safari downloads natively.
// ============================================================================
import { isDatabaseConfigured, sql } from "~/db";
import { resolveAuthToken, SESSION_COOKIE } from "./authServer";
import { buildTemplateCsv } from "./onboarding";
import { TEMPLATE_SLUGS, type TemplateSlug } from "~/types/onboarding";

/** The URL prefix that serves template downloads, e.g. /templates/livestock.csv. */
export const TEMPLATE_DOWNLOAD_PATH = "/templates";

/** The filename an owner gets for a slug — ranch-<slug>.csv (matches
 * getTemplateCsv/buildTemplateCsv naming so nothing regresses). */
export function templateFileName(slug: TemplateSlug): string {
  return `ranch-${slug}.csv`;
}

/** Parse the rmp_session cookie out of a raw Request. Handles single and
 * multiple cookie headers; returns null when absent. */
export function sessionTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === SESSION_COOKIE) {
      const value = part.slice(idx + 1).trim();
      return value.length ? value : null;
    }
  }
  return null;
}

/**
 * Raw-HTTP handler for a template download. Reads the slug from the path
 * (/templates/<slug>.csv), validates the session from the cookie, and returns
 * a real Response — or a redirect to /login?reason=auth when unauthenticated.
 * Unknown slugs are rejected with 404 (never served).
 */
export async function handleTemplateDownload(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const match = /^\/templates\/([a-z0-9-]+)\.csv$/.exec(url.pathname);
  if (!match) return new Response("Not Found", { status: 404 });

  const rawSlug = match[1];

  // Unknown template → 404 (an owner can never download a slug that isn't one
  // of the six real templates).
  if (!(TEMPLATE_SLUGS as readonly string[]).includes(rawSlug)) {
    return new Response("Not Found", { status: 404 });
  }
  const slug = rawSlug as TemplateSlug;

  // AUTH GATE: the raw HTTP layer has no session context, so validate the
  // rmp_session cookie directly against the DB. Unauthenticated / expired →
  // redirect to login exactly like the protected routes (/tasks etc.).
  // Redirect with a RELATIVE Location ("/login?reason=auth"), never an absolute
  // URL built from url.origin: behind the reverse proxy the request's host is
  // the internal upstream (e.g. ip-…beamlit.net), and an absolute redirect would
  // bounce the owner to that internal host instead of the public domain. A
  // relative path is resolved by the browser against the public host they're on.
  const token = sessionTokenFromRequest(req);
  if (!token || !isDatabaseConfigured()) {
    return Response.redirect("/login?reason=auth", 302);
  }
  const auth = await resolveAuthToken(sql(), token);
  if (!auth) {
    return Response.redirect("/login?reason=auth", 302);
  }

  const csv = buildTemplateCsv(slug);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${templateFileName(slug)}"`,
      "Cache-Control": "no-store",
    },
  });
}