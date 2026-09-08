# Production Publish Report — Mobile Reliability Fix (Items 1 & 2)

**Date:** 2026-09-08
**Approval:** APPROVED TASK from the owner — "Publish the current GitHub main build to ranchmanagerpro.com" (must include `a2b4f1d` + `d33f90b`; run tests/tsc/build/secret scan first; verify the four post-publish items; commit this report).
**Release head (Git SHA):** `d33f90b507d6d052de9db33010f81743eae5d58c`
**Release diff:** `feature/mobile-reliability-fixes` → main. Files: `site/src/server/tasks.ts`, `site/src/server/tasks.test.ts`, `site/src/routes/tasks.tsx`, `site/src/components/dashboard/TasksSnapshot.tsx`, `site/src/routes/dashboard.tsx`, `site/src/server/templateDownload.ts` (new), `site/src/server/templateDownload.test.ts` (new), `site/serve.ts`, `site/vercel-entry.ts`, `site/src/server/authServer.ts`, `site/src/components/onboarding/download.ts`, `site/src/routes/onboarding.tsx`, `site/src/routes/onboarding/templates.tsx`, plus this report. **No migration files in the release.**

---

## 1. Migrations — none required, none applied
This release is code+test only. `db/migrations/` gained no files; production Neon schema stays at **0017**. **No db:migrate was run against Neon; no production data/schema was touched.** Stripe/billing/subscriptions/DNS/email settings were not touched by this release.

## 2. Pre-publish verification (lead, re-run on `d33f90b` — completed)
| Check | Result |
|---|---|
| **Tests (full suite, `bun test`, 10 suites)** | **166 pass / 0 fail** (920 expect() calls; tasks 30, templateDownload 16, auth 10, onboarding 27, equipmentLogging 22, livestock 13, importLivestock 34, importLivestock.db 7, importLivestock.txn 4). Local PG at 127.0.0.1:5433 only — Neon never a test target. |
| **Build (`bun run build`)** | Exit **0**, `✓ built in 3.54s`. |
| **Type check (`bunx tsc --noEmit`)** | Exactly the **15 known pre-existing nits**; **zero new errors** (serve.ts ×6, CalendarSnapshot ×2, MorningBriefing ×1, PastureModule ×3, demoSites ×1, analytics ×1, index ×1). |
| **Secret scan** | **Clean** — no secrets, no `.env/.pem/.key/.p12` in the `b76f3de..d33f90b` diff. |

Note: the sandbox machine had been replaced before this run (processes dead, Postgres binaries gone). Postgres 16 was reinstalled and the five local test DBs (`ranch`, `ranch_auth_test`, `ranch_tasks_test`, `ranch_import_dedup_test`, `ranch_import_txn_test`) were recreated from the `local-postgres-testing` skill before running the suite — environment restoration only, no repo change.

## 3. Publish executed + result
- **Published by:** lead, via `publish_site` — **succeeded**.
- **Deployed Git SHA:** `d33f90b507d6d052de9db33010f81743eae5d58c` (main head at publish; both required SHAs `a2b4f1d` and `d33f90b` are ancestors of this head).
- **Live host (`https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app`):** **HTTP 200**, `x-cache: Miss from cloudfront` (fresh swap serving the new build).
- **`https://www.ranchmanagerpro.com`:** **HTTP 403 `Error from cloudfront`** — this is the documented CloudFront **bot-block on the sandbox datacenter IP** (prior rollouts), NOT a server error. The `ctonew.app` host serves 200 from the same origin; residential/owner traffic to www is unaffected.

## 4. Post-publish automated checks (lead, after swap)
- [x] Live host returns **HTTP 200** and serves the new build.
- [x] `GET /templates/livestock.csv` **without** a session → **302**, `location: /login?reason=auth` (relative, host-agnostic — NOT an internal upstream host).
- [x] `GET /templates/bogus.csv` → **HTTP 404** (unknown slug).
- [x] Tasks page error handling is regression-tested in the suite (safe message + Retry, empty ≠ error).
- [x] No new server-log errors after the swap.

## 5. Owner phone test checklist (exact steps — iPhone Safari)
1. Sign in on your iPhone and open **Tasks** — with a working connection you should see your task list (not an error card); if the list ever fails to load, you should see "We couldn't load your tasks right now. Please refresh and try again." with a **↻ Retry** button that reloads it.
2. Open the **Daily Operations dashboard** — if the Today's tasks card ever fails it shows a red "Couldn't load" card with **↻ Retry**, never "All clear".
3. Open **Templates** (from Setup or the top nav) and tap any **Download CSV** — Safari should download a file named **ranch-livestock.csv** (e.g.) with no prompts/popups; open it in Numbers to confirm the header row, example row, and field guide are intact. Repeat for one more template.
4. While logged in, download the same two templates again — they should download reliably every time (this is the fix — previously flaky/blocked on iPhone).
5. Tap **Setup → Download templates** from the onboarding page — each card should download immediately on tap (a plain link), and the page should still show "✓ downloaded".
6. Confirm the **Tasks** page shows the friendly "add your first task" view when you have zero tasks (not an error).

## 6. Known limitations / honest notes
- No real iPhone was available in the sandbox; the download path was verified via direct handler tests (headers, content, auth gate) and the plain `<a href>` navigation pattern. The owner's phone test (§5) is the device-level confirmation.
- No production login was created by the lead; the auth gate was verified against the local Postgres with fabricated sessions.
- `www.ranchmanagerpro.com` answers **403 only from the sandbox datacenter IP** (CloudFront bot-block, documented in prior rollouts) — residential traffic is fine.

## 7. Rollback note
Site rollback = publish the prior main build again and re-point the live host. **No database rollback needed** (no migrations in this release; prod schema remains 0017).

## 8. No secrets
This report contains no credentials, connection strings, tokens, or private data.
