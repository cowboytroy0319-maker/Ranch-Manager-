# Ranch Manager Pro — Beta-Launch Readiness Audit

**Date:** 2026-09-02 · **Repo:** cowboytroy0319-maker/Ranch-Manager- @ `main` (`b2b298f`) · **Author:** engineer (read-only investigation; no production changes, no publish, no data/billing touched)

**Scope:** Was the product safe to start accepting beta users today? Answer: **NOT YET — the #1 blocker is that there is no per-user account/auth boundary, so every visitor with the URL sees one shared ranch's data.** Everything else is green/yellow around that.

---

## 1. Launch checklist (red = blocks beta, yellow = fix before broad, green = ready)

| Area | Status | Evidence |
|---|---|---|
| Auth / account isolation | 🔴 RED — none | No login/session/logout/middleware anywhere in `site/src`. <br>Zero `createServerFn` handlers are authenticated; no `beforeLoad`/route guards in `router.tsx`. Only "session" strings are Stripe Checkout Sessions; only "auth" is `Authorization: Bearer` to Stripe. Anyone with the URL reads & writes the single shared ranch's data. |
| Multi-ranch scoping | 🟡 YELLOW — DB only | `operations` table (single "Default Operation") + `animals.ranch_id` NOT NULL (mig 0013) + per-ranch unique tag index. But no account boundary; authorship comments in `server/livestock.ts` state "no auth layer exists." |
| Backup / restore | 🔴 RED — MISSING | No backup/restore tooling, runbook, or docs in repo or README. Neon has native features; nothing configured or documented here. |
| Error monitoring | 🔴 RED — MISSING | No Sentry/DataDog/anything in deps; no alerting. Only self-hosted `/analytics` page views; server errors go to `.run/server.log` on this machine. |
| Custom domain | 🟡 YELLOW | **ranchmanagerpro.com purchased 2026-09-02** (platform-registered, DNS auto-provisioning); not yet verified to serve the live site — currently remains on the platform subdomain. See §5. |
| Email delivery | 🟡 YELLOW | Platform inbox only; no SendGrid/Postmark/Resend in deps. `subscribers` table captures opted-in emails; nothing sends mail (lead-magnet delivery is on-page, not emailed). |
| Stripe checkout | 🟡 YELLOW | Catalog live (Herd $15 / Ranch $30 / Manager $75 / Legacy $200 monthly; annual = 11 mo, Legacy 10); webhook handler serves `/webhook`; signing secret in DB. **Balance $0.00, zero transactions** — real-money trial path is unproven end-to-end and has no invoices/refund workflow yet. |
| Data persistence | 🟢 GREEN | Livestock, feed, pasture, equipment, expenses, employees, tax exemptions, analytics (page_views), subscribers all read/write Postgres via `createServerFn`. Repo seed = demo fixture. |
| Livestock core | 🟢 GREEN | Renders 30 seed animals on both environments, 0 DB errors; culled/archived/filters live; 13 unit tests pass; unique-tag scoping per ranch. |
| Lead capture | 🟢 GREEN | Landing-page Cost-Per-Head Worksheet signup writes `subscribers` (idempotent). 0 real contacts so far. |
| Build / tests | 🟢 GREEN | `bun run build` exit 0 (3.09 s); `bun test src/server/livestock.test.ts` = 13 pass / 0 fail; `bunx tsc --noEmit` = 15 pre-existing nits, 0 new. No `test` script in package.json (tests run by filename). |
| Mobile | 🟡 YELLOW | Responsive classes present (viewport meta, `w-full`, `sm:`/`md:`/`lg:`, `overflow-x-auto` tables, 2-col grids). Code-inspection only — no device/E2E testing at 375 px. |

---

## 2. URLs + deployed SHA

| Environment | URL | SHA |
|---|---|---|
| Working (dev) | `https://9b3dc5aae6b40835eb587c2a6310f5b4-dev.ctonew.app` | runs local `main` build |
| Public (live) | `https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app` | **Not externally determinable** |

The live site serves the NEW build (Culled/Archived filters + "Livestock Inventory" present, no DB error), which was **not** published by any APPROVED TASK in this session — a deploy evidently happened outside the approved process (by whom unknown, timing unknown, between turns). GitHub `main` = `b2b298f`. Live content proves "some build at or after that work," not a specific SHA; there is no SHA stamp served.

---

## 3. Per-module readiness

| Module | Bucket | Notes |
|---|---|---|
| Signup / lead capture (`/` + `subscribers`) | ✅ implemented & verified | Form + idempotent `INSERT INTO subscribers`. 0 real contacts. |
| Demo (`/demo`) | 🧪 mock & demo-only | `src/data/sample.ts` + `demoSites.ts`; no DB. Intentional. |
| Dashboard (`/dashboard`) | ✅ implemented & verified | "What do I need to do today?" aggregates the DB-backed server functions below. |
| Livestock (`/livestock`) | ✅ implemented & verified | Real Neon data; 30 animals; 13 tests pass. |
| Feed/Hay (`/feed`) | ✅ implemented & verified | `getFeedData` → DB. |
| Pasture (`/pasture`) | ✅ implemented & verified | `getPastureData` → DB (regional recommendations are static sample content — see below). |
| Equipment (`/equipment`) | ✅ implemented & verified | `getEquipmentData` → DB. |
| Expenses (`/expenses`) | ✅ implemented & verified | `getExpensesData`/`getCostData` → DB (cost allocation real). |
| Employees (`/employees`) | ✅ implemented (unverified this session) | `getEmployeesData` → DB. |
| Tax exemptions (`/tax-exemptions`) | ✅ implemented (unverified this session) | `getTaxExemptionsData` → DB (`server/taxExemptions.ts`). |
| Region/pasture intelligence | 🧪 sample content | Scoped as a sample regional-recommendations view (spec-sanctioned, not per-ranch). |
| Horse energy & nutrition | ✅ implemented (code) | Calorie estimator by body weight + workload. |
| Account / subscription (`checkout`, `/webhook`) | ✅ checkout live / ❗ no data | Real Checkout Session (mode=subscription) → owner's Stripe; webhook records events into `subscription_events`. **0 transactions, no invoices exist.** |
| Analytics (`/analytics`) | ✅ implemented & verified | Self-hosted `page_views` table, fire-and-forget beacon in `__root.tsx`. |

---

## 4. Auth + multi-ranch isolation status

- **No authentication exists.** No login, no sessions, no cookies, no route guards, no middleware (`router.tsx` has zero `beforeLoad`); all 35 `createServerFn` handlers are unauthenticated POST/GET calls.
- DB-level scoping is real: single `operations` row (`ranch_id` FK on `animals`, unique `(ranch_id, tag_number)`), but the app hardcodes that one operation. There is no identity layer, so "who is using it" cannot be distinguished.
- **Consequence:** the first real customer's data IS the shared "Default Operation." Cross-customer isolation, onboarding, and per-ranch provisioning don't exist yet. Primary data-integrity blocker for taking real customers.

---

## 5. Domain / deployment / DB / backup / monitoring / email / Stripe

| Concern | Ownership | Readiness |
|---|---|---|
| Domain | **ranchmanagerpro.com** registered 2026-09-02 (platform-managed; DNS auto-provisioned: wildcard CNAME, apex ALIAS, ACM validation — verification in progress). Public URL remains the cto.new subdomain until verified. | YELLOW — owned & brandable; not yet verified to serve the live site. |
| Deployment | Repo has `publish.sh` (build + restart :3000) and `go-live.sh` (Vercel). No repo-owned CI/CD. Platform runs the servers. | YELLOW — publish happened outside the APPROVED-TASK process; no documented owner for "who may deploy." |
| DB | Neon connected via `DATABASE_URL` from platform Secrets; migrations 0001–0013 applied 2026-09-02. Owner controls the connection. | GREEN for schema; RED for backup/DR. |
| Backup/restore | Nothing in repo/docs. | RED — MISSING; configure Neon backup/restore + runbook before real data. |
| Monitoring | Self-hosted `/analytics` (page views) only. | RED for errors — no error tracking/alerting. |
| Email | Platform inbox; `subscribers` is capture-only. No transactional provider in deps. | YELLOW — no outbound delivery to opted-in contacts yet. |
| Stripe | Owner's "T Bar T" account; catalog + webhook live; owner handles refunds in dashboard. | YELLOW — real checkout wired, 0 transactions; trial/invoice/refund workflow undocumented. |

---

## 6. Top five blockers to accepting beta users

1. **No per-user authentication/account boundary (RED).** Anyone with the URL sees one shared ranch's data; cross-customer isolation does not exist.
2. **No backup/restore process for the live Neon DB (RED).** First real customer data is unrecoverable if anything goes wrong.
3. **No error monitoring/alerting (RED).** An outage or broken page is invisible until someone reports it.
4. **No custom domain + undocumented deploy ownership (YELLOW).** A deploy landed on the public site outside any APPROVED TASK — the process gap, not the deploy itself, is the issue.
5. **Single-tenant data model (RED for >1 customer).** The first real customer's data IS the shared "Default Operation"; taking two real ranches requires per-ranch operations provisioning + auth that don't exist.

*Consider also:* real-money trial with no invoices/refund workflow documented; mobile untested on devices; no `test` script in package.json.

---

## 7. Recommended 14-day beta-launch sequence (one actionable line per day — owner: O)

- **D1–D2** — Build & ship auth/account boundary (login, per-user identity) + per-ranch `operations` provisioning + hard-code the operator to their own ranch. (O: owner, E: engineer)
- **D3–D4** — Write backup/restore runbook; enable + test first Neon backup; attempt a restore into a throwaway branch. (O: owner w/ engineer)
- **D5** — Configure error monitoring/alerting (Sentry or platform logging) + wire deploy alerts. (O: engineer)
- **D6–D7** — Purchase custom domain, attach it, and write a documented publish/deploy ownership policy (who may deploy, how to verify SHA). (O: owner + lead)
- **D8** — Add transactional email (subscriber confirmation w/ the free Worksheet) or document the inbox-only workflow with a manual send checklist. (O: lead/engineer)
- **D9–D10** — Harden checkout for real money: test trial→cancel→refund end-to-end, generate an invoice, document refund path. (O: engineer + owner's Stripe access)
- **D11–D12** — Recruit 2–3 pilot ranches from the owner's network; onboarding call + explicit data consent. (O: owner)
- **D13** — Pilot data-entry + daily-use validation (gate/barn test — "faster than notebook?"). (O: pilots + owner)
- **D14** — Review pilot feedback → go/no-go for broader beta; publish the honest-result postmortem. (O: owner + lead)

---

## 8. Uncertainty (stated plainly)

- **Deployed SHA is unknowable from outside.** GitHub `main` = `b2b298f`; live content shows a new build but no SHA stamp. Live publish timing and author are unknown (occurred between turns, outside APPROVED TASK).
- **No real-user traffic/usage data exists.** 0 subscribers, 0 Stripe transactions, 3 owner-referred demo invites with no replies as of 9/1.
- **"Verified" here = code inspection + build + SSR render + unit tests**, not click-through E2E with real user journeys or real data entry.
- **Mobile = code inspection only** (viewport meta, `w-full`, `sm:`/`md:`/`lg:` grids, `overflow-x-auto` tables), not device testing at ~375 px.
- This audit is read-only: nothing was migrated, seeded, published, or billed.

---

## 9. Env vars referenced (NAMES ONLY — no values)

`DATABASE_URL` · `PORT` · `secertkey` (intentional misspelling read by `checkout.ts`; documented in `.env.example`) · `STRIPE_WEBHOOK_SECRET` (also stored in the DB `app_settings` table) · `VERCEL_TOKEN` (go-live only). Placeholders in `.env.example`: `DATABASE_URL`, `PORT`, `STRIPE_WEBHOOK_SECRET`, `secertkey`, `VERCEL_TOKEN`. No `.env` files and no secret-shaped strings found in committed source. The Stripe publishable key is not referenced in client code — checkout is a server-initiated Checkout Session (Stripe-hosted page), which is why no publishable key appears in `src`.