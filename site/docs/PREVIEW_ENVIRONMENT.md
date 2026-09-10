# Preview environment: disposable database + DB error firewall

This document explains how the **preview environment** (the "working site" the
team and owner use while reviewing features) gets its own disposable database,
so preview testing can never write to — or break — the **production** database,
and what the app does when a preview database isn't ready.

---

## 1. The problem this solves

Both the preview environment and the live site run the **same build bundle**,
and until now both read the same `DATABASE_URL` (the production Neon database).
When preview-testing code that needs a new migration (e.g. `0018` — restock
log, pasture activities, livestock movements), the preview would run against
production *before* that migration was applied there, surfacing raw database
errors like `relation "restock_log" does not exist` to whoever was testing.

## 2. The fix — two parts

### 2a. A separate database for preview (env-var selection)

`src/db.ts` now resolves the database connection per deployment:

| Environment | `DATABASE_URL`            | `PREVIEW_DATABASE_URL`      | Database actually used |
| ----------- | ------------------------- | --------------------------- | ---------------------- |
| **Live**    | production Neon           | **must NOT be set**         | production Neon (unchanged) |
| **Preview** | (whatever is set)         | the disposable scratch DB   | the scratch DB         |
| Local dev   | local Postgres            | (optional, usually not set) | `DATABASE_URL` (unchanged) |

**Why an env var (and not request-host detection):** both environments run the
identical build bundle, so there is no build-time signal; the DB client is a
process-wide singleton, not request-scoped, so host-based switching would have
to thread the request host through every server function. The one reliable
per-deployment signal is the deployment's environment variables. Presence of
`PREVIEW_DATABASE_URL` **is** the preview switch — the live deployment simply
never sets it, so live behavior is bit-for-bit unchanged, and local dev without
the variable works exactly as before.

### 2b. No user ever sees a raw database error (`src/dbErrors.ts`)

Every query runs through the guarded client in `src/db.ts`. Any
database-originated failure (missing table/column, constraint violation,
connection refused/ended, etc.) is rewritten **before any handler sees it**:

- **Preview environment:** the user sees exactly
  **"This preview is being prepared. Please try again shortly."**
- **Live environment:** the preview message never appears; DB failures surface
  the codebase's existing generic customer-safe wording
  ("We couldn't complete that right now. Please try again.").

App-thrown customer-safe errors (validation messages, "That hay stack no
longer exists.", inventory-below-zero, auth errors, …) pass through completely
unchanged. The raw technical detail (SQLSTATE code + original message) is
logged **server-side only** via `console.error` at the DB layer.

## 3. What the owner needs to do (one secret, one scratch database)

1. **Create a scratch database** for the preview — e.g. a **new, empty Neon
   project** (a few clicks, free tier is fine). Do **not** point it at the
   production project. No data needs to be copied; the app's migrations create
   the schema, and any seed/demo data can be added later with `bun run db:seed`
   against it.
2. **Add one secret to the preview deployment only:**

   ```
   PREVIEW_DATABASE_URL = postgresql://<user>:<password>@<preview-host>/<preview-db>?sslmode=require
   ```

   (exact Neon-style connection string of the scratch project). Never set
   `PREVIEW_DATABASE_URL` on the live deployment — the live site must only ever
   have `DATABASE_URL`.
3. Run the site's migrations once against the scratch DB
   (`DATABASE_URL=<scratch url> bun run db:migrate`), or just let the first
   deploy run them; they are idempotent and tracked in `schema_migrations`.

That's it. From then on the preview runs entirely on the disposable database:
restocks, pasture activities, expenses and everything else can be exercised
freely with zero risk to production, and all migrations (including `0018`) live
there.

## 4. Proof this works (run locally anytime)

Local disposable Postgres on `127.0.0.1:5433`:

```bash
PGBIN=/usr/lib/postgresql/16/bin
runuser -u postgres -- $PGBIN/psql -p 5433 \
  -c "DROP DATABASE IF EXISTS ranch_preview;" -c "CREATE DATABASE ranch_preview;"
cd /home/team/shared/site
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" bun run db:migrate
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
PREVIEW_DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
  bun qa/previewSmoke.ts        # all smoke checks must pass
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
  bun test src/dbErrors.test.ts # firewall regression suite
```

`qa/previewSmoke.ts` verifies through the app's real server code paths:
manual expense save + fresh-connection read-back; hay restock with a cost
(inventory up, exactly one linked expense, idempotent replay); restock without
a cost (inventory up, zero expenses); pasture activity with a cost (exactly one
linked expense); and that a real schema failure surfaces only the preview
message — never a raw PostgreSQL error.

## 5. Guarantees

- Production `DATABASE_URL` behavior is untouched: without
  `PREVIEW_DATABASE_URL` the code path is identical to before (plus error
  masking that only makes messages *safer*).
- The preview message can never appear on the live site — it is only produced
  when `PREVIEW_DATABASE_URL` is set (preview deployments only).
- Migrations/operator tooling (`db/migrate.ts`, `db/seed.ts`) use `rawSql()` so
  their technical errors stay technical for the operator.
