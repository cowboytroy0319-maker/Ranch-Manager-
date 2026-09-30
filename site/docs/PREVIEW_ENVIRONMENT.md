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

## 2c. The two refusals (`src/dbGuard.ts`) — and the preview status page

Selecting a database by `APP_ENV` is not enough on its own: a *misconfigured*
preview still reaches production. Every time a connection is resolved, both
directions are checked, and a refusal means **no query is executed and there is
never a silent fallback** (loud server-side log + a customer-safe error):

| Direction | Refused when | Rule |
| --- | --- | --- |
| preview (`APP_ENV=preview`) | `PREVIEW_DATABASE_URL` missing/blank | `PREVIEW_DATABASE_URL_MISSING` |
| preview | `PREVIEW_DATABASE_URL` is not a usable connection string | `PREVIEW_DATABASE_URL_UNPARSEABLE` |
| preview | preview target `host:port/dbname` equals `DATABASE_URL`'s target, **or** the preview host is the production host | `PREVIEW_TARGET_EQUALS_PRODUCTION` |
| production (`APP_ENV` unset or anything else) | `PREVIEW_ENV_EXPECTED` is set while the mode is not `preview` — a preview deployment that lost its `APP_ENV` | `PREVIEW_ENV_EXPECTED_BUT_NOT_PREVIEW` |
| production | `DATABASE_URL` points at preview-marked data (`ranch_preview`, `*_preview`, or the same target as `PREVIEW_DATABASE_URL`) | `PRODUCTION_DB_IS_PREVIEW` |

The DB error firewall above is unchanged: refusals pick the same
environment-appropriate customer-safe wording, and preview wording still only
ever appears in preview mode.

`/preview-status` (server-rendered, public, phone-friendly) reports the verdict
verbatim: environment mode + which variable supplied it, the preview database
identity as `user@host:port/dbname` (never a password), whether that is the
production target, the production host name, the guard state (pass / refused +
rule), migrations applied + latest, and the branch + commit the working tree was
synced from (`.preview-deployment.json`).

## 2d. Operator tooling refuses production too (`db/migrate.ts`, `db/seed.ts`)

`bun run db:migrate` / `bun run db:seed` refuse to run against a
**production-marked** target (a hosted/Neon host, or a host/database name
beginning with `prod`) unless `--allow-production` is passed explicitly, and they
refuse every misconfigured preview above regardless of flags. A refusal connects
to nothing. This is the guard that stops a bare `bun run db:migrate` in a shell
that exports the production `DATABASE_URL` from migrating production. Preview
work therefore always looks like:

```bash
env -u DATABASE_URL APP_ENV=preview PREVIEW_ENV_EXPECTED=1 \
  PREVIEW_DATABASE_URL=postgres://preview_app@127.0.0.1:5432/ranch_preview \
  bun run db:migrate
```

## 3. How the preview deployment gets its mode locally (this sandbox)

The phone-reachable preview is the managed `vite dev` server in this directory.
Platform secrets reach both environments, so `APP_ENV` is **never** a platform
secret; the dev server gets its mode from a local, gitignored file instead:

```bash
site/scripts/preview-env.sh up       # role + database + .preview-env + migrations
site/scripts/preview-env.sh status   # mode + database identity + migration count
site/scripts/preview-env.sh down     # remove .preview-env (leaves the database)
```

* `.preview-env` (chmod 600, gitignored, excluded from the shared-tree rsync)
  holds `APP_ENV=preview`, `PREVIEW_DATABASE_URL`, `PREVIEW_ENV_EXPECTED=1`.
* `vite.config.ts` loads it **only** when `command === "serve"` (the dev /
  working-site server). The published site runs `serve.ts` and never takes that
  branch, so it stays on `DATABASE_URL` byte for byte.
* The file is **not** named `.env.local` on purpose: Bun auto-loads
  `.env`/`.env.local` into `process.env` for *every* process it starts in this
  directory — including `bun run start` (the published server) and a bare
  `bun run db:migrate` — which would hand preview mode to a published process.
* The scratch database is `ranch_preview`, owned by the dedicated role
  `preview_app` with a generated password that lives only in `.preview-env` and
  the root-only credential file. It is persistent for the whole audit cycle.
* `site/scripts/sync-shared-site.sh` performs the full-tree sync of this repo's
  `site/` into the working tree and rewrites `.preview-deployment.json`
  (branch/commit/sync time/marker) that `/preview-status` reads.

## 3b. What the owner needs to do for a REAL hosted preview (two variables, one scratch database)

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

Local disposable Postgres on `127.0.0.1:5432` (never the `ranch_ci` test database;
`site/scripts/preview-env.sh up` creates role + database + `.preview-env`):

```bash
cd /home/team/shared/site
site/scripts/preview-env.sh up        # creates preview_app + ranch_preview, migrates it
site/scripts/preview-env.sh status    # mode + identity + migration count

# Guards (pure unit tests, no database needed):
bun test src/dbGuard.test.ts

# Firewall + selection regression suite. The preview-mode cases need their own
# database (a preview pointed at the production target is refused by design), so
# DATABASE_URL stays the CI test database while PREVIEW_DATABASE_URL is derived
# as ranch_preview on the same local cluster:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/ranch_ci" \
  bun test src/dbErrors.test.ts
```

Anything that mutates the scratch database goes through the explicit preview
environment — never through the inherited `DATABASE_URL`:

```bash
env -u DATABASE_URL APP_ENV=preview PREVIEW_ENV_EXPECTED=1 \
  PREVIEW_DATABASE_URL="postgresql://preview_app@127.0.0.1:5432/ranch_preview" \
  bun run db:migrate
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
