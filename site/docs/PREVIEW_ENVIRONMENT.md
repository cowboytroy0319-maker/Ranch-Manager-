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

### 2a. An explicit deployment mode (`APP_ENV`) selects the database

`src/db.ts` resolves the database connection per deployment from an explicit
**`APP_ENV`** variable (values `production` | `preview`):

| `APP_ENV`      | Database actually used                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `preview`      | `PREVIEW_DATABASE_URL` **only** — fail-closed (`undefined`) if it is missing/blank; never falls back to `DATABASE_URL`. |
| `production`, unset, or **any** other value (incl. local dev) | `DATABASE_URL` **only** — `PREVIEW_DATABASE_URL` is ignored even if accidentally present. |

**Why an explicit variable (and not "presence of `PREVIEW_DATABASE_URL`"):** the
presence-of-var switch was a production-safety bug — a live deployment with
`PREVIEW_DATABASE_URL` accidentally set would silently use the scratch DB.
`APP_ENV` is the explicit control: the owner *names* the mode, so a stray
`PREVIEW_DATABASE_URL` on production is inert. There is no hostname detection
anywhere — both environments run the identical build bundle, and the DB client
is a process-wide singleton, so the deployment's environment variables are the
only reliable signal.

### 2b. No user ever sees a raw database error (`src/dbErrors.ts`)

Every query runs through the guarded client in `src/db.ts`. Any
database-originated failure (missing table/column, constraint violation,
connection refused/ended, etc.) is rewritten **before any handler sees it**:

- **Preview environment (`APP_ENV=preview`):** the user sees exactly
  **"This preview is being prepared. Please try again shortly."**
- **Production / any other mode:** the preview message never appears; DB
  failures surface the codebase's existing generic customer-safe wording
  ("We couldn't complete that right now. Please try again.").

App-thrown customer-safe errors (validation messages, "That hay stack no
longer exists.", inventory-below-zero, auth errors, …) pass through completely
unchanged. The raw technical detail (SQLSTATE code + original message) is
logged **server-side only** via `console.error` at the DB layer.

## 3. What the owner needs to do (two variables, one scratch database)

1. **Create a scratch database** for the preview — e.g. a **new, empty Neon
   project** (a few clicks, free tier is fine). Do **not** point it at the
   production project. No data needs to be copied; the app's migrations create
   the schema, and any seed/demo data can be added later with `bun run db:seed`
   against it.
2. **Set two variables on the preview deployment:**

   ```
   APP_ENV=preview
   PREVIEW_DATABASE_URL = postgresql://<user>:<password>@<preview-host>/<preview-db>?sslmode=require
   ```

   (exact Neon-style connection string of the scratch project).
3. **Set one variable on the live deployment:**

   ```
   APP_ENV=production
   ```

   The live site must only ever have `APP_ENV=production` and `DATABASE_URL`.
   **Never set `PREVIEW_DATABASE_URL` on the live deployment** (and never set
   `APP_ENV=preview` there) — with the explicit switch, even a stray
   `PREVIEW_DATABASE_URL` on production is ignored, but the correct setting is
   to leave it off.
4. Run the site's migrations once against the scratch DB
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
APP_ENV=preview \
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
PREVIEW_DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
  bun qa/previewSmoke.ts        # all smoke checks must pass
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/ranch_preview" \
  bun test src/dbErrors.test.ts # firewall + selection regression suite
```

`qa/previewSmoke.ts` verifies through the app's real server code paths:
manual expense save + fresh-connection read-back; hay restock with a cost
(inventory up, exactly one linked expense, idempotent replay); restock without
a cost (inventory up, zero expenses); pasture activity with a cost (exactly one
linked expense); and that a real schema failure surfaces only the preview
message — never a raw PostgreSQL error.

## 5. Guarantees

- Production `DATABASE_URL` behavior is untouched: without `APP_ENV=preview` the
  code path is identical to before (plus error masking that only makes messages
  *safer*), and `PREVIEW_DATABASE_URL` is ignored even if accidentally set.
- The preview message can never appear on the live site — it is only produced
  when `APP_ENV === "preview"` (preview deployments only).
- Preview fails closed: if `APP_ENV=preview` but `PREVIEW_DATABASE_URL` is
  missing/blank, the app reports "database not configured" rather than ever
  touching `DATABASE_URL`.
- Migrations/operator tooling (`db/migrate.ts`, `db/seed.ts`) use `rawSql()` so
  their technical errors stay technical for the operator.
