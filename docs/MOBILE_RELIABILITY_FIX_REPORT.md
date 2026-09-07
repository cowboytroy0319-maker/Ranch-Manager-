# Mobile Reliability Fix — Implementation Report (Items 1 & 2)

**Date:** 2026-09-05 (engineer delegation)
**Branch:** `feature/mobile-reliability-fixes` (PR — see final message)
**Scope:** Two customer-facing reliability fixes only. **No migrations, no schema/data changes, no Stripe/billing/subscription/DNS/email changes, no new features.**

---

## 1. What changed

### Item 1 — Customer-safe error handling in the Tasks module

**Problem:** users could see raw database errors. `src/routes/tasks.tsx` rendered `<pre>{data.error}</pre>` under a "Database error" title, and the server fns `getTasksData` / `getDashboardTasks` returned `err.message` (SQL, constraint text, column names) to the client. The dashboard's `TasksSnapshot` also silently swallowed errors by showing the "All clear / Nothing overdue" empty state whenever `tasks = []`.

**Fix:**
- `src/server/tasks.ts` — both read fns now `console.error` the real error **server-side** and return a fixed, safe message instead: `TASKS_LOAD_ERROR_MESSAGE = "We couldn't load your tasks right now. Please refresh and try again."` (exported constant, referenced by tests). `configured` semantics kept correct. The real error never crosses to the client.
- `src/routes/tasks.tsx` — replaced the raw `<pre>` error block AND the developer "✅ Database not configured" block with the same customer-safe message, no SQL/column/migration/dev-command text, plus a visible **↻ Retry button** wired to `router.invalidate()` (re-runs the loader). No sensitive copy anywhere in the states.
- `src/components/dashboard/TasksSnapshot.tsx` — new `error` + `onRetry` props. On load failure it renders the SAME safe message + **↻ Retry** (no fake "All clear"); the genuine zero-task empty state ("Nothing overdue or due today…") is preserved and only renders when `error` is absent.
- `src/routes/dashboard.tsx` — threads `tasks.error` and a `router.invalidate()`-based `retryTasks` into the card.

**Empty-vs-error distinction (preserved):** `getTasksData` success with zero tasks returns `{ configured: true, tasks: [], … }` with **no `error` key** → the friendly "add your first task" view. A load failure returns `{ error: TASKS_LOAD_ERROR_MESSAGE, tasks: [] }` → the error + Retry view. Tests assert both shapes differ.

### Item 2 — Reliable iPhone template downloads (server-side CSV)

**Problem:** `src/components/onboarding/download.ts` did a client-side Blob + `a.click()` download — flaky/blocked on iPhone Safari.

**Fix:**
- **New `src/server/templateDownload.ts`** — a raw-HTTP handler for `GET /templates/<slug>.csv`:
  - **Real file download headers:** `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="ranch-<slug>.csv"` (exact `getTemplateCsv`/`buildTemplateCsv` naming preserved).
  - **Authenticated at the HTTP layer:** reads the `rmp_session` cookie from the raw Request; validates the token directly against `sessions`/`users` via a new **pure `resolveAuthToken(db, token)` helper** extracted in `src/server/authServer.ts` (same SHA-256 token-hash + session lookup the login path uses; `requireAuth`/`resolveAuth` now share it). Unauthenticated/expired → `302 /login?reason=auth` (matches protected routes); unknown slug → 404.
  - Wired into **both** server entries exactly like `/webhook`: `serve.ts` (before static/SSR) and `vercel-entry.ts` (before the fetch handler).
- `src/components/onboarding/download.ts` — repurposed to build the plain download URL (`/templates/<slug>.csv`), client-safe (no server imports).
- `src/routes/onboarding.tsx` and `src/routes/onboarding/templates.tsx` — the Download buttons are now real `<a href={templateDownloadUrl(slug)}>` anchors (a normal navigation Safari downloads natively). `markTemplatesDownloaded` is still called (best-effort, non-blocking) so setup progress keeps counting.
- No popups, no external services, no macros, no browser-specific hacks.

## 2. Files changed

| File | Change |
|---|---|
| `site/src/server/tasks.ts` | Safe error message + server-side logging in `getTasksData`/`getDashboardTasks` |
| `site/src/server/tasks.test.ts` | + regression tests (safe message, error shape, empty-vs-error distinct) |
| `site/src/routes/tasks.tsx` | Customer-safe error + not-configured states; Retry via `router.invalidate()` |
| `site/src/components/dashboard/TasksSnapshot.tsx` | `error`/`onRetry` props; error state ≠ empty state |
| `site/src/routes/dashboard.tsx` | Threads tasks error + Retry into the card |
| `site/src/server/templateDownload.ts` | **New** — raw-HTTP CSV download handler (auth gate, headers) |
| `site/src/server/templateDownload.test.ts` | **New** — handler tests (headers, content, auth rejection) |
| `site/serve.ts` | Intercepts `/templates/*.csv` at the HTTP layer |
| `site/vercel-entry.ts` | Same intercept for the Vercel entry |
| `site/src/server/authServer.ts` | New pure `resolveAuthToken(db, token)` (shared by requireAuth path) |
| `site/src/components/onboarding/download.ts` | Repurposed → `templateDownloadUrl()` (client-safe) |
| `site/src/routes/onboarding.tsx` | Template cards → real `<a href>` download links |
| `site/src/routes/onboarding/templates.tsx` | Download buttons → real `<a href>` download links |

Templates/slugs/content in `src/types/onboarding.ts` and `buildTemplateCsv` were **not changed** — all six (livestock, pastures, hay-feed, equipment, expenses, tasks) still have a distinct `ranch-<slug>.csv` filename, header row, example row, and field-legend/guidance block (verified by tests).

## 3. Verification results (all run on this branch, local only)

| Check | Result |
|---|---|
| **Tests — full suite (`bun test`, local PG 127.0.0.1:5433)** | **159 pass / 0 fail** across 10 files: tasks (30, ranch_tasks_test), templateDownload (16, NEW), auth (10, ranch_auth_test), onboarding (27), equipmentLogging (22), livestock (13), importLivestock (34), importLivestock.db (7, ranch_import_dedup_test), importLivestock.txn (4, ranch_import_txn_test). Production Neon was never a test target. |
| **Type check (`bunx tsc --noEmit`)** | Exactly the **15 known pre-existing nits** (serve.ts ×6, CalendarSnapshot ×2, MorningBriefing ×1, PastureModule ×3, demoSites ×1, analytics ×1, index ×1). **Zero new errors** in any changed file. |
| **Production build (`bun run build`)** | **Exit 0** — `✓ built in 3.24s`. |
| **Secret scan** | **Clean** — no secret patterns in the diff, no `.env/.pem/.key/.p12` added. New server module contains no credentials (session token hashing only). |

Item-2 route verified by direct handler tests (no shared :3000 server): each of the six slugs returns 200 + `text/csv; charset=utf-8` + `attachment; filename="ranch-<slug>.csv"` + body identical to `buildTemplateCsv(slug)`; no-cookie / unknown-token / expired-session → 302 to `/login?reason=auth`; unknown slug → 404.

## 4. Honest notes — what could NOT be verified from this sandbox

- **No real iPhone/Safari** available: the Safari-specific download behavior (server-attachment navigation vs the old Blob click) was verified by the raw handler tests + the plain `<a href>` navigation pattern, not on a device.
- **No production login created** (prohibition): the route's auth gate was verified against the local test Postgres with fabricated session tokens, not against the production account.
- **No live URL exercised:** this branch was not published (the lead publishes). `serve.ts`/`vercel-entry.ts` intercepts are verified by the shared handler module + the same wiring pattern the /webhook intercept uses (which is live), but the live `/templates/*.csv` path is only exercised after the lead's publish.
- **Local Postgres had to be reinstalled after the sandbox machine was replaced** (apt install postgresql-16, initdb on :5433, recreate the four test DBs) before the DB-backed tests could run — this was environment restoration, no repo change.

## 5. What the owner now sees

- **Tasks page / dashboard task card on a load failure:** "We couldn't load your tasks right now. Please refresh and try again." + a **↻ Retry** button. No SQL, no column names, no stack traces, no migration details, no internal IDs, no dev commands.
- **Tasks page with genuinely no tasks:** unchanged friendly "add your first task" view (distinct from error).
- **Dashboard with a failed task fetch:** the red "Couldn't load" card with Retry — never a misleading "All clear".
- **Template downloads on iPhone:** tapping a template card navigates to `/templates/<slug>.csv`, the server validates the session and serves a real attachment file download (`ranch-<slug>.csv`). Downloads still count toward setup progress.

## 6. No secrets

This report contains no credentials, connection strings, tokens, or private data.