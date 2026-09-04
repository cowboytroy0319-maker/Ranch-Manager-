# Ranch Manager Pro

A centralized ranch and farm management platform: livestock, pasture, hay/feed, equipment, fuel, registrations, expenses with cost allocation — anchored on the daily question **"What do I need to do today?"**

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TanStack Start (file-based routes), Vite 7, Tailwind CSS 4 |
| Backend | TanStack Start server functions (`src/server/*.ts`) on a Bun/Node HTTP server |
| Database | PostgreSQL (Neon) via `postgres` driver (`@neondatabase/serverless` for serverless) |
| Billing | Stripe Subscriptions (hosted Checkout) + raw-body webhook at `/webhook` |
| Runtime | Bun (scripts + local dev); Node-compatible SSR bundle for Vercel |

## Quick start (local)

Prerequisites: [Bun](https://bun.sh) (>= 1.x) and a Postgres database (a local one or Neon free tier).

```bash
# 1. install deps
bun install

# 2. configure environment (fill in YOUR OWN values; never commit .env)
cp .env.example .env
#    - DATABASE_URL       Postgres connection string
#    - PORT               default 3000
#    - STRIPE_WEBHOOK_SECRET  Stripe webhook signing secret (whsec_...)
#    - secertkey          Stripe secret key (sk_live_...) — note the
#                         intentionally-misspelled env name, read by
#                         src/server/checkout.ts
#    - VERCEL_TOKEN       only needed for Vercel deploys

# 3. create schema (runs db/migrations/*.sql in order — idempotent)
bun db:migrate

# 4. (optional) load demo data: animals, hay, feed, pasture, equipment,
#    maintenance, fuel, expenses, employees, tax exemptions, ...  (~30 animals)
bun db:seed

# 5. run the dev server
bun run dev        # http://localhost:3000
```

Production (self-host): `bun run build && bun run start` (serves via `serve.ts`).

## Routes / features

- `/` — marketing landing page + **lead-magnet signup** (free worksheet in exchange for email; stores opted-in contacts in `subscribers`)
- `/demo` — interactive full-feature demo (9 modules) with sample data
- `/dashboard` — **Daily Operations** view ("What do I need to do today?"): livestock health, pasture moves, hay/feed, maintenance due, renewals
- `/livestock` — herd snapshot by species, per-animal view, horse energy/feed calculator (Mcal/day from body weight + workload); required ear tags (unique **within the operation/ranch**, not globally), acquisition dates, culled/archived history, sex/breed/location filters
- `/feed` — hay & feed inventory (bales/types, feed stores, usage log)
- `/pasture` — pastures, grazing log, forage intelligence + regional recommendations (rotational vs continuous vs feedlot; cattle/horses/goats/sheep)
- `/equipment` — equipment, maintenance records ("mark done" workflow), fuel log
- `/expenses` — cost allocation to herd/lot, pasture, equipment, job, category → cost per head/acre/bale/mile
- `/employees` — crew, roles, pay types, schedule
- `/tax-exemptions` — tax exemption records
- `/tasks` — daily task list & projects: quick-add (title/due/priority/category, expandable details), filters by status/priority/due/category/project, one-tap complete/reopen, inline edit, projects panel; feeds the dashboard's "Today's tasks" card (see `docs/TASKS_MODULE.md`)
- `/analytics` — self-hosted site analytics (page views, unique visitors, referrers)
- `/blog/...` — content pages; `/worksheet` — free lead-magnet worksheet
- Checkout — Stripe subscription tiers: Herd $15 / Ranch $30 / Manager $75 / Legacy $200 (annual = pay 11 months)

## Authentication & ranch isolation

Accounts are real per-ranch logins (migration `0014_auth_users_operations.sql`):

- **Users + server-side sessions.** Registration creates a row in `users` (email stored lowercase, unique) with a salted scrypt password hash (`scrypt:N:r:p:salt:hash`, from `node:crypto`) — plaintext is never stored. Sign-in opens a `sessions` row keyed by the SHA-256 hash of a random 32-byte token; the client only ever holds the raw token in an **HttpOnly, SameSite=Lax** cookie (`rmp_session`, 30-day expiry). The raw token is never persisted server-side.
- **One ranch/operation per account, owner role.** `registerCore` always creates a **new** `operations` row named by the customer plus one `operation_memberships` row with role `owner`. A registered user never lands on the seeded "Default Operation" and never sees its demo data. Crew invites (worker/viewer roles) are a later milestone.
- **Every operational module is scoped by the session operation.** Each read/write server fn (`getFeedData`, `saveHay`, `logUsage`, `saveAnimal`, `getLivestockData`, `getPastureData`, `getEquipmentData`, `getCostData`, `getExpensesData`, `getEmployeesData`, `getTaxExemptionsData`, ...) calls `requireAuth()` first, then filters every query by `auth.operationId`; writes additionally guard their `UPDATE/INSERT ... WHERE operation_id` so a cross-ranch write affects zero rows and is rejected.
- **No Default-Operation fallback for customer data.** Pre-existing/demo rows are backfilled onto the Default Operation by the migration; customer accounts get a fresh, empty operation. Sessionless requests are rejected (`requireAuth` throws "Not authenticated").
- **Flows:** `/register` (ranch name + email + password → creates account + operation + owner session → `/dashboard`), `/login` (correct credentials → session → `/dashboard`; wrong password → "Incorrect email or password."), sign-out clears the session row and cookie.

## Environment variables (NAMES only)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `PORT` | HTTP port (default 3000) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (whsec_...) |
| `secertkey` | Stripe secret key (note the misspelling) |
| `VERCEL_TOKEN` | Vercel API token for CLI deploys |
| `VERCEL_SCOPE` / `VERCEL_TEAM_ID` | optional Vercel team overrides |

## Database schema (`db/migrations/`, idempotent)

21 tables across 14 migrations: `operations`, `herd_groups`, `animals`, `health_events`, `hay_inventory`, `feed_inventory`, `usage_log`, `pastures`, `pasture_assignments`, `grazing_log`, `pasture_observations`, `equipment`, `maintenance_records`, `fuel_log`, `subscription_events`, `app_settings`, `expenses`, `page_views`, `subscribers`, `employees`, `tax_exemptions`, `projects`, `tasks`. (Migration `0014` adds `users`, `operation_memberships`, `sessions` and the `operation_id` scoping columns; migration `0015` adds the tasks & projects tables — both are applied to prod separately. See "Authentication & ranch isolation" above and `docs/TASKS_MODULE.md`.)

Important: `0006_app_settings.sql` seeds a `stripe_webhook_secret` row — in this repository the value is a **placeholder** (`whsec_REPLACE_ME_EXAMPLE_ONLY`). Supply your real secret via the `STRIPE_WEBHOOK_SECRET` env var (the webhook handler reads env first, then the DB row as a fallback). The live production database already holds the correct value; fresh installs must set the env var or update the row.

## Integrations / third-party services

| Service | Use |
|---|---|
| Neon (Postgres) | production database |
| Stripe | subscriptions, checkout, webhook events |
| Vercel | hosting (Build Output API) |
| GitHub | source control |
| Site analytics | self-hosted (no third-party tracker) |
| Email | platform-managed (opted-in subscribers only) |

## Deployment (Vercel)

```bash
# commits → push → Vercel Build Output API bundle → deploy
bun run build          # builds dist/client + dist/server
./build-vercel.sh      # assembles .vercel/output (Build Output API v3)
bunx vercel deploy --prebuilt   # or ./go-live.sh with VERCEL_TOKEN set
```

`serve.ts` handles production serving locally + routes raw-body Stripe webhook deliveries (`/webhook`) before SSR. `vercel-entry.ts` adapts the Node launcher for Vercel's `render.func`.

## Scripts (package.json)

| Script | What it does |
|---|---|
| `dev` | `vite dev` — local dev server |
| `build` | `vite build` — client + SSR |
| `start` | `bun run serve.ts` — production server |
| `db:migrate` | run migrations (idempotent) |
| `db:seed` | load demo data (idempotent) |
| `publish` / `go-live` | deployment helpers |

## Status notes

- **Known issues:** none open from the last full browser-QA pass. One historical caveat: the QA browser tool sometimes rendered a stale app-shell after deploy while the live origin served the new build (tool artifact, not a site defect) — see `qa/QA_REPORT.md`.
- **Backlog (not built):** subscriber announcement/send flow (needs ≥1 real subscriber), locale-ready currency/units, Canada expansion, GTM directory listings.

Built with TanStack Start. See `SITE.md` and `qa/QA_REPORT.md` in `site/` vs repo root respectively for more.