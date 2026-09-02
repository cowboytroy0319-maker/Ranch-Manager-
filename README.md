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
- `/livestock` — herd snapshot by species, per-animal view, horse energy/feed calculator (Mcal/day from body weight + workload)
- `/feed` — hay & feed inventory (bales/types, feed stores, usage log)
- `/pasture` — pastures, grazing log, forage intelligence + regional recommendations (rotational vs continuous vs feedlot; cattle/horses/goats/sheep)
- `/equipment` — equipment, maintenance records ("mark done" workflow), fuel log
- `/expenses` — cost allocation to herd/lot, pasture, equipment, job, category → cost per head/acre/bale/mile
- `/employees` — crew, roles, pay types, schedule
- `/tax-exemptions` — tax exemption records
- `/analytics` — self-hosted site analytics (page views, unique visitors, referrers)
- `/blog/...` — content pages; `/worksheet` — free lead-magnet worksheet
- Checkout — Stripe subscription tiers: Herd $15 / Ranch $30 / Manager $75 / Legacy $200 (annual = pay 11 months)

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

20 tables across 11 migrations: `herd_groups`, `animals`, `health_events`, `hay_inventory`, `feed_inventory`, `usage_log`, `pastures`, `pasture_assignments`, `grazing_log`, `pasture_observations`, `equipment`, `maintenance_records`, `fuel_log`, `subscription_events`, `app_settings`, `expenses`, `page_views`, `subscribers`, `employees`, `tax_exemptions`.

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