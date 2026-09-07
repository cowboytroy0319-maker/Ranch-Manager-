# Production Publish Report — Mobile Reliability Fix (Items 1 & 2)

> **Template status:** the engineer delegation verified everything that can be verified locally (tests, tsc, build, secret scan — see `MOBILE_RELIABILITY_FIX_REPORT.md`). The live-deploy fields below are for the **lead to complete after `publish_site`**. Nothing in this file was published by the engineer.

**Date:** _(lead fills after publish)_
**Approval:** _(lead fills — owner approval reference for the publish)_
**Release head (Git SHA):** _(lead fills — the SHA of main after merge / at publish)_
**Release diff:** `feature/mobile-reliability-fixes` → main. Files: `site/src/server/tasks.ts`, `site/src/server/tasks.test.ts`, `site/src/routes/tasks.tsx`, `site/src/components/dashboard/TasksSnapshot.tsx`, `site/src/routes/dashboard.tsx`, `site/src/server/templateDownload.ts` (new), `site/src/server/templateDownload.test.ts` (new), `site/serve.ts`, `site/vercel-entry.ts`, `site/src/server/authServer.ts`, `site/src/components/onboarding/download.ts`, `site/src/routes/onboarding.tsx`, `site/src/routes/onboarding/templates.tsx`, plus this report. **No migration files in the release.**

---

## 1. Migrations — none required, none applied
This release is code+test only. `db/migrations/` gained no files; production Neon schema stays at **0017**. **No db:migrate was run against Neon; no production data/schema was touched.** Stripe/billing/subscriptions/DNS/email settings were not touched by this release.

## 2. Pre-publish verification (engineer, all local — completed)
| Check | Result |
|---|---|
| **Tests (full suite, `bun test`, 10 suites)** | **159 pass / 0 fail** (tasks 30, templateDownload 16 NEW, auth 10, onboarding 27, equipmentLogging 22, livestock 13, importLivestock 34, importLivestock.db 7, importLivestock.txn 4). Local PG only — Neon never a test target. |
| **Build (`bun run build`)** | Exit **0**, `✓ built in 3.24s`. |
| **Type check (`bunx tsc --noEmit`)** | Exactly the **15 known pre-existing nits**; **zero new errors**. |
| **Secret scan** | **Clean** — no secrets, no `.env/.pem/.key/.p12` in the diff. |

## 3. Publish executed + result
- **Published by:** _(lead fills — `publish_site`)_
- **Preview/working host check:** _(lead fills — the -dev.ctonew.app build hash before/after)_
- **Live host check (`https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app`):** _(lead fills — served `app-*.css`/asset hash before vs after publish)_
- **`https://www.ranchmanagerpro.com`:** _(lead fills — note the datacenter-IP 403 CloudFront bot-block documented in prior rollouts; owner verifies from residential)_
- **Deployed Git SHA:** _(lead fills)_

## 4. Post-publish automated checks (lead, after swap)
- [ ] curl the preview + live hosts return **HTTP 200** and serve the new build asset hash
- [ ] `GET /templates/livestock.csv` **without** a session → **302 to /login?reason=auth** (and with a logged-in browser → attachment download `ranch-livestock.csv`)
- [ ] Tasks page renders normally with real data (no error card)
- [ ] No new server-log errors after the swap

## 5. Owner phone test checklist (exact steps — iPhone Safari)
1. Sign in on your iPhone and open **Tasks** — with a working connection you should see your task list (not an error card); if the list ever fails to load, you should see "We couldn't load your tasks right now. Please refresh and try again." with a **↻ Retry** button that reloads it.
2. Open the **Daily Operations dashboard** — if the Today's tasks card ever fails it shows a red "Couldn't load" card with **↻ Retry**, never "All clear".
3. Open **Templates** (from Setup or the top nav) and tap any **Download CSV** — Safari should download a file named **ranch-livestock.csv** (e.g.) with no prompts/popups; open it in Numbers to confirm the header row, example row, and field guide are intact. Repeat for one more template.
4. While logged in, download the same two templates again — they should download reliably every time (this is the fix — previously flaky/blocked on iPhone).
5. Tap **Setup → Download templates** from the onboarding page — each card should download immediately on tap (a plain link), and the page should still show "✓ downloaded".
6. Confirm the **Tasks** page shows the friendly "add your first task" view when you have zero tasks (not an error).

## 6. Known limitations / honest notes
- No real iPhone was available in the sandbox; the download path was verified via direct handler tests (headers, content, auth gate) and the plain `<a href>` navigation pattern. The owner's phone test (§5) is the device-level confirmation.
- No production login was created by the engineer; the auth gate was tested against the local Postgres with fabricated sessions.
- `www.ranchmanagerpro.com` is expected to answer **403 only from the sandbox datacenter IP** (CloudFront bot-block, documented in prior rollouts) — residential traffic is fine.

## 7. Rollback note
Site rollback = publish the prior main build again and re-point the live host. **No database rollback needed** (no migrations in this release; prod schema remains 0017).

## 8. No secrets
This report contains no credentials, connection strings, tokens, or private data.