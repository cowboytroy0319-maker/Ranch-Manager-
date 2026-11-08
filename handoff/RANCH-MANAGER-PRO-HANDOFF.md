# Ranch Manager Pro — Exit / Handoff Package (continuing OUTSIDE CTO.new)

**Compiled:** 2026-11-08 (UTC) by the engineer agent, from live inspection of the team machine + `gh`/`git` reads.
**Scope honored:** read-only inventory + this docs-only branch (`handoff/exit-package`). No deploys, publishes, merges, migrations, deletions, DNS changes, or credential changes were made. No secret VALUES appear in this document — names and storage locations only.
**Labels:** **LIVE VERIFIED** = checked today (2026-11-08) on this machine / via network. **DOCUMENTED** = from prior verified sessions and their saved evidence. **NOT VERIFIABLE FROM THIS MACHINE** = said so explicitly, with the best available evidence.

---

## 1. LIVE REPOSITORY / BRANCH / DEPLOYED COMMIT

| Item | Value | Status |
|---|---|---|
| GitHub repo | `https://github.com/cowboytroy0319-maker/Ranch-Manager-` (remote of clone `/home/engine/work/ranch`) | **LIVE VERIFIED** (`git remote -v`) |
| Default branch | `main` (`origin/HEAD -> origin/main`) | **LIVE VERIFIED** |
| `origin/main` HEAD | `43374e7` "Owner priorities 1-3: stable login + password reset, permanent complimentary owner access, visible Log in on the main page (#9)" (committed 2026-09-26) | **LIVE VERIFIED** (after `git fetch origin`, read-only) |
| Commit PRODUCTION actually serves | **NOT recorded in any deployment-metadata file on this machine.** The only deployment metadata present is `/home/team/shared/site/.preview-deployment.json`, which records the PREVIEW, not production. Best evidence: (a) live site answers HTTP 200 today behind Cloudflare (`curl -sI https://www.ranchmanagerpro.com` → 200, cf-nel headers); (b) the repo's only main-era build artifacts on this machine date to the main state — `site/dist/` built 2026-09-26 02:52, `site/.run/managed-server` contains `dev`; (c) the live homepage's Stripe-checkout wiring matches main-era source (`src/routes/index.tsx` imports `createCheckout` from `~/server/checkout`; `src/server/checkout.ts` exists — the basis of proposal (b)). Conclusion: production serves a build of main-era code ≈ `43374e7`, plus whatever the platform's own `publish_site` build last swapped — **NOT VERIFIABLE FROM THIS MACHINE**; best evidence stated above. | NOT VERIFIABLE (best evidence given) |
| PREVIEW commit + marker | branch `feature/financial-expense-linking` @ `e40c0665ed1b857eed012da42a3c00aff28b66cc` (short `e40c066`), marker `preview-e40c066-20261026T005238Z`, syncedAt `2026-10-26T00:52:38Z`, syncedFrom `/tmp/eng-fin2/site/site` (now gone) → syncedTo `/home/team/shared/site` — per `/home/team/shared/site/.preview-deployment.json` | **LIVE VERIFIED** (file read today) |
| `/home/team/shared/site` | The working/preview tree — **NOT a git repository** (a full-tree sync of the e40c066 commit; `git status` → "not a git repository") | **LIVE VERIFIED** |
| Local clones | `/home/engine/work/ranch` — branch `feature/restock-expense-reliability-audit` @ `b3ccd3578ebf4c0a5dd3e94188790b1ccfe3927d`, clean worktree, HEAD == upstream, last commit 2026-09-30 | **LIVE VERIFIED** |
| | `/home/work/rmp-restock` — detached HEAD `43374e7`, **mid-rebase on `feature/restock-total-cost-paid`**, 170 dirty `git status` entries (mostly mass file deletions); stale September scratch — no unique work identified; treat as discardable (see §2/§14) | **LIVE VERIFIED** |
| | `/home/work/rmp` — plain file copy, **no `.git`**; `/home/work/probe-x` — contains only `t.txt` | **LIVE VERIFIED** |
| `/tmp/eng-fin2` | **NO LONGER EXISTS** (`ls -d /tmp/eng-fin2` → nothing; /tmp was wiped). Cited as the build tree in coverage-matrix-final.md; the commits it held are pushed to GitHub, so nothing is lost. | **LIVE VERIFIED** |

---

## 2. OPEN PRs / BRANCHES / UNCOMMITTED-UNPUSHED WORK

**All PR states below LIVE VERIFIED 2026-11-08** via `gh pr list --repo cowboytroy0319-maker/Ranch-Manager- --state all --limit 40 --json number,title,state,headRefName,headRefOid,baseRefName` (run from `/home/engine/work/ranch`).

**OPEN (6):**
| PR | Title (short) | Head branch | Head SHA | Base |
|---|---|---|---|---|
| #12 | Financial audit Phase 2 part 1: repair + fuel costs reach Expenses (D1+D3) — 0021 idempotency, edit/void, shared expenseLink | `feature/financial-expense-linking` | `e40c0665ed1b857eed012da42a3c00aff28b66cc` | main |
| #11 | P1: preview-only scratch database + two-way mode guards + /preview-status | `feature/restock-expense-reliability-audit` | `b3ccd3578ebf4c0a5dd3e94188790b1ccfe3927d` | main |
| #10 | Owner priority 4: visible "Total cost paid" field in the restock flow | `feature/restock-total-cost-paid` | `b38db76b687a8067a679a1d132b9bdfebf46aea7` | main |
| #8 | Mobile restock/expense workflow + homepage Log in header (salvaged) | `feature/mobile-restock-expense-workflow` | `a467c8114d9701d1e766cfc7c56407f6b9c45c7b` | main |
| #7 | Vercel preview deployment config (preview-only) | `feature/vercel-preview-config` | `b9951fbdaa2f0a96dee300fd66573ab37b2398d6` | main |
| #6 | Secure password reset + explicit complimentary-access flag (migration 0019, unapplied) | `feature/password-reset-complimentary` | `6a46fd13be0572003b05e376afab5464ba8de8fa` | main |

**MERGED:** #9, #5, #3, #2, #1. **CLOSED (unmerged):** #4.

**PR #12 vs PR #11 containment (the question the owner asked): `git merge-base --is-ancestor b3ccd357… e40c0665…` → YES-CONTAINED.** `git merge-base` of the two heads == `b3ccd357…` == PR #11's head exactly. So **PR #12's branch already contains every commit of PR #11** — merging #12 lands #11's work too (9 commits unique to #12 beyond #11: `56a0e91` (0021 + expenseLink cores), `7d033e2`, `973a586`, `6c9777b`, `c6c1c8d`, `74b7379` (0022 + two-path), `50eacb0`, `6f50f13`, `e40c066`). **PR #10's head is NOT contained in #12** (`--is-ancestor b38db76… → NOT-CONTAINED`) — #10 must be merged (or closed) separately.

**Remote branches (13, LIVE VERIFIED via `git branch -r` after fetch):** `main`, `feature/financial-expense-linking`, `feature/login-reset-owner-access`, `feature/mobile-login-accessibility`, `feature/mobile-reliability-fixes`, `feature/mobile-restock-expense-workflow`, `feature/owner-complimentary-access`, `feature/password-reset-complimentary`, `feature/preview-auth-flow`, `feature/product-blocker-data`, `feature/restock-expense-reliability-audit`, `feature/restock-total-cost-paid`, `feature/vercel-preview-config`.

**Uncommitted/unpushed work:**
- `/home/engine/work/ranch`: clean worktree; `HEAD == @{u}` (`b3ccd357…`); `git log --branches --not --remotes --oneline` → empty. **Nothing unpushed.** **LIVE VERIFIED**
- `/home/work/rmp-restock`: mid-rebase state (`no branch, rebasing feature/restock-total-cost-paid`), 170 dirty entries, HEAD at the Sept merge `43374e7`. It is interrupted scratch from the September restock work; its branch's commits exist on origin (`feature/restock-total-cost-paid @ b38db76`). No unique content identified; do not trust it as the source of anything. **LIVE VERIFIED** (state described; uniqueness NOT provable without untangling the rebase)
- `/home/team/shared/site`: not a git repo (synced tree of pushed commit `e40c066`) — no local-only git state possible. **LIVE VERIFIED**

---

## 3. BUILD / START / TEST + RUNTIME VERSIONS

**Exact scripts — `site/package.json` (LIVE VERIFIED):**
```
dev:            vite dev
build:          vite build
start:          bun run serve.ts          # production SSR server, port 3000
publish:        bash ./publish.sh         # platform "publish" path
go-live:        bash ./go-live.sh         # alternate: deploy to Vercel
db:migrate:     bun db/migrate.ts
db:seed:        bun db/seed.ts
db:seed:demo:   bun db/seedDemo.ts
db:check-schema: bun db/schemaCheck.ts    # deploy-time schema gate (D4)
db:preflight-0018: bun db/preflight0018.ts
e2e:restock:    bun qa/restockE2E.ts      # Playwright E2E (browser)
format:         prettier --write .
```
Tests: `bun test` (20 test files counted in `db/` + `src/**` on the synced tree; prior verified suite runs: 479 tests / 0 failures — **DOCUMENTED**).

**Preview start** — `/home/team/shared/site/scripts/preview-env.sh` (18,644 bytes, mtime 2026-10-26): `APP_ENV=preview` mode; loop-mounts the data image; reads env file `/home/team/shared/site/.preview-env` (438 bytes, mode 660; **contains NAMES only as far as this doc is concerned**: `APP_ENV`, `PREVIEW_ENV_EXPECTED`, `PREVIEW_DATABASE_URL`) and DB credentials from `/home/team/shared/.local/pg/preview-credentials` (mode 600; JSON keys: `PREVIEW_DB_ROLE`, `PREVIEW_DB_PASSWORD`, `PREVIEW_DB_HOST`, `PREVIEW_DB_PORT`, `PREVIEW_DB_NAME`). Recovery command after host replacement: `preview-env.sh up` (per `audit/financial-workflow/preview-data-survival.md`). **DOCUMENTED + files LIVE VERIFIED.**

**Production publish path** — `/home/team/shared/site/publish.sh` (LIVE VERIFIED, read today):
1. `bun install`
2. `bun run build`
3. **Deploy-time schema gate (audit defect D4):** `bun run db:check-schema` — read-only; fails the release if any migration file in `db/migrations/` is not recorded in the target's `schema_migrations`, or if any queried object/constraint (incl. `uq_restock_log_operation_request`, `uq_pasture_activities_operation_request`, `uq_maintenance_records_operation_request`, `uq_fuel_log_operation_request`) is missing. Escape hatch `SKIP_SCHEMA_CHECK=1` (deliberately noisy). Refusal behavior + object manifest documented in `db/schemaCheck.ts` header. A failed gate leaves the previous release serving.
4. `setsid nohup bun run start > .run/server.log 2>&1 &` (serve.ts frees port 3000 across users, then binds; script waits until `http://localhost:3000` answers).
The platform's `publish_site` wraps this same build → gate → swap flow. **LIVE VERIFIED** (script source).

**Versions on this machine (2026-11-08, LIVE VERIFIED):** `bun 1.4.4`; `node v22.23.4`; **`psql` NOT INSTALLED** (no `psql`/`postgres` binaries anywhere; `/var/lib/postgresql` absent — the machine has been reprovisioned since the Oct 26 sessions; Postgres tooling must be reinstalled to run the preview DB or the backup scripts). Production Postgres major version = **18** (stated and enforced by `scripts/backup-prod-readonly.sh`: "production is PG 18, whose dumps carry `SET transaction_timeout = 0` that a PG 16 server rejects"). **DOCUMENTED.** No `engines` field in package.json; no `.bun-version`/`.nvmrc` found.

---

## 4. PRODUCTION + PREVIEW HOSTING

**Production (public app):**
- URL `https://www.ranchmanagerpro.com` — **HTTP 200 today** (2026-11-08 07:37 UTC); bare domain `https://ranchmanagerpro.com` → **301 → https://www.ranchmanagerpro.com/**. **LIVE VERIFIED** (curl).
- Both hostnames resolve to **Cloudflare proxy IPs** (`104.21.42.107`, `172.67.205.64`) — the public site is fronted by Cloudflare. **LIVE VERIFIED** (DNS resolution).
- Serving origin: **CTO.new platform hosting**. What is visible from this machine: the platform manages the working/preview dev server (`site/.run/managed-server` = `dev`; `site/.run/dev.log` = vite route warnings, last write 2026-10-26 00:58) and the publish/build/swap flow (`publish.sh`, §3). At inspection time **nothing was bound to port 3000 on this machine** (`ss -tlnp` → empty; no vite/serve/postgres processes) and the preview/working URLs answered **503** — see below. The platform-side config/process that fronts the live domain is **NOT VERIFIABLE FROM THIS MACHINE**.
- DB: hosted **Neon** Postgres — identifiers in §5.

**Preview (owner's fake-data sandbox + the team's working site):**
- URLs: `https://9b3dc5aae6b40835eb587c2a6310f5b4-dev.ctonew.app` (preview) and `https://9b3dc5aae6b40835eb587c2a6310f5b4-dev.cto.site` (working site) — **both answered HTTP 503 (retry-after 10) at 2026-11-08 07:37 UTC** because no app server process is running on this machine and no Postgres is installed (machine reprovisioned since Oct 26). The data is NOT lost — see next line. **LIVE VERIFIED** (curl + ss + ps).
- **How the preview survives: the data lives on a loop-mounted disk image under `/home`, not in the machine's system paths.** `/home/team/shared/.local/pg/ranch_preview-data.img` — **939,524,096 bytes (~896 MiB)**, mtime 2026-10-26 01:40, still present today with data intact but **currently NOT mounted** (mountpoint `/home/team/shared/.local/pg/ranch_preview-fs` exists and is empty; no loop mount active). Postgres `ranch_preview` cluster lives inside the mounted image. Older superseded image kept at `/home/team/shared/.local/pg/backup/ranch_preview-data.img.stopped.20260928T182738Z` (268,435,456 bytes). Survival proven across two real host replacements + continuity check 2026-10-25 — `audit/financial-workflow/preview-data-survival.md`. **LIVE VERIFIED** (image/size/mount state today) + **DOCUMENTED** (survival events).
- Restart path on a machine with Postgres installed: `preview-env.sh up` (installs what it needs if missing per `scripts/preview-env.sh`, then mounts + starts).

---

## 5. NEON IDENTITIES + APPLIED MIGRATIONS

**Neon (production DB) — identifiers only, extracted from the `DATABASE_URL` env var on this machine; no password printed:**
- Host: `ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech`
- Port: `5432` · Database: `neondb` · Role: `neondb_owner`
- A second secret named `Neon` exists in the CTO.new secret store (likely a Neon API key; the app code never reads that name — grep of `process.env.*` shows only the names in §8). **LIVE VERIFIED** (identifiers; name-list only).

**Applied migrations:**
- **Production:** **NOT VERIFIABLE FROM THIS MACHINE today** (no `psql`/Postgres installed). Best evidence on-machine: the replay proofs of the 2026-09-30 production backups (`/home/team/shared/backup/prod-20260930T*.restore-verify.txt`, `prod-20260930T035507Z.replay-proof.txt`) record **`migrations=19`** — i.e. **0001→0019 applied to production as of 2026-09-30** (row counts then: users=1, operations=2, expenses=12, pastures=10, hay_inventory=8, feed_inventory=7, equipment=13). Whether `0020_password_reset` was applied to production after that date is unknown from here. One-command re-verification once psql exists: `psql "$DATABASE_URL" -Atc "select count(*) from schema_migrations"` (read-only).
- **Preview:** **DOCUMENTED 22 migrations** (0001→0022) — coverage-matrix-final.md Phase 3b identity gate (2026-10-23) and preview-data-survival.md continuity check (2026-10-25), both LIVE-VERIFIED in those sessions at marker `preview-6f50f13-20261023T020032Z`; preview then re-synced to `e40c066` 2026-10-26 (marker `preview-e40c066-20261026T005238Z`). Not re-verifiable today (no Postgres on this machine).
- **Repo inventory (LIVE VERIFIED via git ls-tree):** `site/db/migrations/` on the synced tree and on `origin/feature/financial-expense-linking` contains **`0001_livestock.sql` → `0022_fuel_two_path.sql` (22 files)**. **`origin/main` contains only `0001→0020` (21 files).**
- **Which PR introduces 0021/0022:** both exist **only on PR #12's branch**. `0021_equipment_expense_linking.sql` added by commit **`56a0e91`**; `0022_fuel_two_path.sql` added by commit **`74b7379`** (`git log -- <file>` on the branch). Production (main-era build + 19 applied as of 09-30) therefore has **neither 0021 nor 0022** — and this is exactly what `publish.sh`'s schema gate (D4) refuses to release against until production migrations are applied.

---

## 6. BACKUP

**Tooling (both LIVE VERIFIED — read today):**
- `/home/team/shared/audit/fresh-replayable-backup.sh` — takes a **read-only** logical dump of the production Neon DB (`pg_dump --clean --if-exists --no-owner --no-privileges` under `PGOPTIONS='-c default_transaction_read_only=on'`, `$DATABASE_URL` target), writes `/home/team/shared/backup/prod-<STAMP>-clean.sql` + `.replay-proof.txt`, then PROVES it: (1) loads into an empty local PG 18 scratch DB at `127.0.0.1:5434/replay_proof`, (2) re-replays the same dump onto the now-populated DB, (3) compares production-vs-replayed row MD5 checksums. Requires `/usr/lib/postgresql/18/bin/{pg_dump,psql}` and a running PG18 scratch cluster — **neither exists on the current machine image** (Postgres absent entirely), so the script cannot run until PG18 tooling is reinstalled.
- `/home/team/shared/site/scripts/backup-prod-readonly.sh` — same idea with a `manifest.json` + `restore-verify.txt`; hard rules: refuses a target that looks local, refuses port 5432 (preview), refuses scratch targets off 127.0.0.1, never prints the connection string. Invocation: `PROD_DATABASE_URL='postgresql://…' bash scripts/backup-prod-readonly.sh`.

**Latest artifact (LIVE VERIFIED listing today):**
- `/home/team/shared/backup/prod-20260930T130638Z-clean.sql` — **208,214 bytes**, dated **2026-09-30 13:06 UTC**, owner `root:root`, mode 644, with its proof `/home/team/shared/backup/prod-20260930T130638Z-clean.replay-proof.txt` (2,104 bytes). Seven more dumps + proofs from 2026-09-30 03:38–04:30 sit in the same directory.

**Restore into a fresh Neon or local Postgres (per the script's own proofs):** the dump is `--clean --if-exists` plain SQL — restore = `psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f prod-<stamp>-clean.sql` onto an EMPTY database (proof 1) or onto one that already holds the tables (proof 2 — the rollback case); the script's proof 3 then diff-checks production vs replayed rows. Nothing Neon-specific in the dump.

**Does a production backup exist?** **YES — but only on THIS machine, and STALE (2026-09-30, ~5.5 weeks old).** No backup exists off this machine, and none newer than the 09-30 owner-approved migration run. **This is the #1 gap — see §14.** The stale dump does still prove restorable (its replay-proof exists).

---

## 7. UPLOAD / FILE STORAGE

**The app writes NO user files anywhere — DB and session rows only.** **LIVE VERIFIED** (grep across `src/`, `api/`, `scripts/`, `serve.ts`):
- Only file-adjacent feature = **livestock CSV import**, parsed in memory: `src/server/importLivestockServer.ts` (records the original filename in an audit row; rejects non-CSV; `src/types/importLivestock.ts` caps uploads at 1 MB). No `writeFile`/`createWriteStream`/multer/uploads-directory code exists.
- Sessions are DB rows: `sessions` table in `db/migrations/0014_auth_users_operations.sql` (with `sessions_expires_at_idx`).
- **Receipt-scan: does NOT exist in the repo.** No branch on origin matching `receipt` (`git branch -a | grep -i receipt` → none), no commits mentioning it (`git log --all --grep=receipt -i` → none); the only "receipt" anywhere is a textarea placeholder "Receipt detail, delivery notes…" in `src/components/expenses/ExpenseForm.tsx:159`. The prior claim that it was "a preview-only experiment on its own branch" is not supported by anything on origin or this machine today — it was never pushed. No production upload storage shipped.

---

## 8. ENV-VARIABLE NAMES + SECURE STORAGE (NO VALUES)

**Every env var the app reads** (grep `process.env.*` across `src/`, `db/`, `scripts/`, `serve.ts`, `api/` — **LIVE VERIFIED**):
- `DATABASE_URL` — production DB connection (production: CTO.new platform env / Secrets; preview: `.preview-env` on this machine)
- `APP_ENV` — `"production"` | `"preview"`; the explicit mode switch (src/db.ts: `resolveDatabaseUrl()` — preview mode uses PREVIEW_DATABASE_URL ONLY; anything else uses DATABASE_URL)
- `PREVIEW_DATABASE_URL`, `PREVIEW_ENV_EXPECTED` (preview guard), `PREVIEW_LOGIN_CRED_FILE` (default `/home/team/shared/.local/preview-login.env`), `PREVIEW_LOGIN_PASSWORD` (seed/test only)
- `RMP_RESET_TEST_MODE` — password-reset test mode; returns the reset link instead of "sending" it; must NEVER be set where real users exist (`src/server/passwordResetServer.ts:33-93`)
- `SCHEMA_CHECK_WARN_ONLY`, `SKIP_SCHEMA_CHECK` — deploy-gate controls (db/schemaCheck.ts, publish.sh)
- `STRIPE_WEBHOOK_SECRET` (src/server/webhook.ts) and **`secertkey`** (owner-chosen name for the Stripe secret key, src/server/checkout.ts)
- Deploy tooling only: `VERCEL_TOKEN`, `VERCEL_SCOPE`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_NAME`, `CTO_ENV_FILE`, `BACKUP_DIR`, `PROD_DATABASE_URL`, `SCRATCH_ADMIN_URL`, `PG_DUMP_BIN`, `PSQL_BIN` (go-live.sh / backup scripts)
- **`RESEND_API_KEY` — NOT present anywhere** in the code or environment (email-delivery proposal (a) is written but NOT built; nothing sends email today).

**Where secrets are stored (names/locations only):**
- **CTO.new Secrets (platform)** → injected into `/etc/profile.d/cto-env-vars.sh` on this machine. Variable NAMES present (**LIVE VERIFIED** name-list; values never printed): `DATABASE_URL`, `Neon`, `OPENAI_API_KEY`, `RanchManagementPro`, `livekey`, `publishstripeapi`, `secertkey`, `secret`, `stripesecertapikey`, `webhook`, `webhook2`, `webhook4`, `whsec`. (Most non-standard names are the owner's own names for Stripe keys/webhook secrets; `webhook.ts` and `checkout.ts` fall back to parsing the saved env file for them.)
- **GitHub token** → `/etc/profile.d/team-github.sh` (exports `GH_TOKEN`) and `/home/team/.data/.git-credentials` (419 bytes, mtime today 07:29).
- **Preview-only credential files on this machine** (infrastructure, not reports): `/home/team/shared/site/.preview-env` (mode 660), `/home/team/shared/.local/pg/preview-credentials` (mode 600), `/home/team/shared/.local/preview-login.env` (seed login credential; default of `PREVIEW_LOGIN_CRED_FILE`).

**⚠️ EXPORT WARNING:** if CTO.new is canceled, **the platform Secrets store dies with it** and these values are unrecoverable. The owner must export the VALUES (from CTO.new → Settings → Secrets, or from this machine's `/etc/profile.d/cto-env-vars.sh` before leaving) for at least: **`DATABASE_URL`** (the Neon connection string — though the DB itself survives at Neon, the password lives here), **all Stripe-related names** (`secertkey`, `stripesecertapikey`, `livekey`, `publishstripeapi`, `secret`, `whsec`, `webhook`, `webhook2`, `webhook4`), `Neon`, `OPENAI_API_KEY`, `RanchManagementPro`, plus `GH_TOKEN` (regenerate at GitHub instead if preferred). Do this BEFORE leaving CTO.new.

---

## 9. DOMAIN / DNS + DEPLOY AUTOMATION

- **Domains:** `www.ranchmanagerpro.com` (200 today) + bare `ranchmanagerpro.com` (301 → www) — **LIVE VERIFIED** today by curl. Both resolve to **Cloudflare edge IPs** (104.21.42.107, 172.67.205.64) — the domain is proxied through Cloudflare (cf-nel/report-to headers present).
- **Where DNS is MANAGED:** **NOT VERIFIABLE FROM THIS MACHINE** — no registrar/DNS config exists in the repo or on the machine (nothing in `site/`, `vercel.json` is build config only, no zone files). The Cloudflare fronting shows the zone is at least proxied by Cloudflare; whether the authoritative DNS/registrar is Cloudflare directly or a registrar pointing at Cloudflare is exactly what the lead's parallel registrar check is determining.
- **How www points at the platform:** the public origin is CTO.new platform hosting (the same machine's port-3000 server / platform proxy per §4). The exact CNAME/A target of www is not visible from inside the machine (Cloudflare proxies hide it). **NOT VERIFIABLE FROM THIS MACHINE.**
- **Publish path:** `publish_site` (platform tool) → `publish.sh`: `bun install` → `bun run build` → **schema gate** `bun run db:check-schema` (read-only; refuses release if any migration file is unapplied in the target DB or any required object/constraint is missing; `SKIP_SCHEMA_CHECK=1` noisy escape hatch) → `setsid bun run start` (serve.ts binds :3000) → waits for `localhost:3000` to answer. **LIVE VERIFIED** (script source). Automation runs on CTO.new infra + this machine.
- **Elsewhere:** any host with Bun + Postgres can replace it — build (`bun run build`), gate (`bun run db:check-schema`), serve (`bun run start`, port 3000), DNS at any registrar/Cloudflare → new host. A full **Vercel** alternative is already built and documented: `go-live.sh` (prebuilt Build Output API deploy; reads every saved secret from the env file), `build-vercel.sh`, `vercel-build.mjs`, `vercel-entry.ts`, `api/render.*`, `vercel.json`, and `docs/VERCEL_DEPLOYMENT.md` (documents a Vercel project `ranch-management-pro/ranch-manager-preview` and the exact build failure it fixes).

---

## 10. SCHEDULED / BACKGROUND JOBS

**None. No recurring jobs of any kind. LIVE VERIFIED 2026-11-08:**
- `crontab -l` → **crontab command not found** (no cron installed on the current machine image).
- `systemctl list-timers` → not booted with systemd (no init-system timers).
- No platform scheduled-task config visible anywhere in `site/` or `shared/` (no timer/periodic files; no `node-cron`/`setInterval`-driven jobs in app code beyond request handling).
- **CI (GitHub Actions — runs on GitHub's infra, survives CTO.new):** `repo/.github/workflows/ci.yml` — trigger `pull_request`; job `test` on ubuntu-latest: Bun (setup-bun@v2) + Postgres 16 service container → `bun install --frozen-lockfile` → `bun run db:migrate` (scratch `ranch_ci` DB only, DATABASE_URL forced to `127.0.0.1:5432` — the DB-backed tests refuse non-local URLs so they can never touch the owner's Neon) → `bun test` → `bun run build` → **typecheck gate**: `tsc --noEmit` diffed against the 15-entry baseline `site/tsc-baseline.txt` (`comm -23`; only NEW errors fail; baseline may only shrink).
- **Second workflow** `repo/.github/workflows/restock-reliability.yml` — triggers: `push` (all branches), `pull_request`, `workflow_dispatch`; timeout 25 min; runs `bun test` plus `bun run e2e:restock` — the restock→expense guarantee driven through a real browser at 375/390/430 px against the preview-mode server + preview scratch DB (owner's numbers: 25 bales, "Triple C Hay", $312.50), screenshots kept as artifacts. Both workflows also exist at PR #12's head (`git ls-tree` verified).

---

## 11. FINANCIAL COVERAGE MATRIX / DEFECTS / EVIDENCE

- **Coverage matrix (the owner-facing record):** `/home/team/shared/audit/financial-workflow/coverage-matrix-final.md` (35,623 bytes, 2026-10-26) — **v2 by the independent verifier**: **30 money-entry workflows → 23 PASS / 5 FAIL / 2 NOT TESTED**; per-failure annotation blocks (FAILURE / WORKAROUND / PRIORITY / explicit RELEASE-BLOCKER verdict) — **all eight annotated items judged DOES NOT BLOCK PR #12's release** (verifier's independent verdicts awaiting owner ratification). Built on the owner's rule set (one entry → one linked expense; purchase expensed once; draw = usage only; edit/void syncs the SAME expense; totals never double-count).
- **Defect ledger D1–D9:** `audit/financial-workflow/ranked-defects.md` (+ root-cause-and-environment.md, reproduction-results.md). Repaired on PR #12: **D1** (equipment service/fuel linked expenses, commit `56a0e91`), **D2** (dashboard double-count — ledger-first read, `6c9777b`), **D3** (permanent schema-fault logging + edit/void cores, `56a0e91`/`973a586`), **D7** (quick-add deep links, `973a586`). **Outstanding per annotations:** **D8** — manual-expense duplicate protection (no `client_request_id` on the plain INSERT at `expenses.ts:362–390`; proposal (c), migration 0023), **D4/D5/D6** — cross-module money capture (equipment purchase, livestock buy/sell, vet costs, labor; proposal (d)), **D9** — financial export (scored a capability gap; ledger-only export semantics that cannot double-count). Note: the deploy-time schema gate historically called "D4" is DONE and shipped (`db/schemaCheck.ts` + publish.sh) — the matrix's outstanding D-rows and the proposal docs are the authority on current numbering.
- **Evidence packs (all under `/home/team/shared/proof/financial-workflow/`, LIVE VERIFIED present today):** `reproduction-20261020T040314Z/`, `phase3-20261020T060445Z/`, `phase3b-20261023T020311Z/` (10/10 PASS on final commit `6f50f13` at 375 px; 15 screenshots + db/ + browser/ subpacks), `phase3c-20261026T005534Z/` (7/7 PASS on `e40c066` — the fuel/service fresh-state fix; final preview ledger 35 expenses / $15,926.77, zero expenses ever linked to a draw).
- **Audit write-ups:** `audit/financial-workflow/{phase3,phase3b,phase3c}-verification.md`, `root-cause-and-environment.md`, `reproduction-results.md`, `coverage-matrix-draft.md`, plus `audit/financial-workflow/preview-data-survival.md` (host-replacement survival) and the 0018 production-change packet (`audit/0018-production-change-packet.md` + evidence).
- **Owner-decision proposals (all WRITTEN, PLANNED, nothing executed) — `/home/team/shared/proposals/`:** (a) `password-reset-email-delivery-proposal.md` (Resend; secrets-first; no email is deliverable today); (b) `homepage-claims-correction-proposal.md` — key finding: the live homepage "Get started" buttons fire LIVE Stripe checkout requests against nonexistent subscription prices (visitor one click from a visible Stripe error); copy-only fix, awaiting owner-approved PR; (c) `manual-expense-duplicate-protection-proposal.md` (D8, migration 0023); (d) `cross-module-money-capture-and-export-proposal.md` (D4/D5/D6 + D9, decision menu, two flagged owner decisions).

---

## 12. CTO.new-DEPENDENCY INVENTORY (WHAT STOPS IF CANCELED)

**DIES with CTO.new:**
1. **Platform hosting of the public app** — dies. Replacement: any host with **Bun ≥ 1.4 + Postgres** (Neon already exists): `bun install && bun run build && bun run db:check-schema && bun run start` (port 3000) — see §13. A ready Vercel alternative also exists (§9, `go-live.sh` + `docs/VERCEL_DEPLOYMENT.md`).
2. **The `*.ctonew.app` preview URL** — dies. Replacement: the preview is just this app in `APP_ENV=preview` mode against a scratch Postgres; host it anywhere (or drop it — it is a fake-data sandbox; nothing of value lives only there per preview-data-survival.md).
3. **THIS machine — including `/home/team/shared` in its entirety:** the preview disk image (`/home/team/shared/.local/pg/ranch_preview-data.img`), ALL audit/proof/proposals/growth/docs/skills/backup artifacts, and the local credential files. Dies unless exported. **MUST-EXPORT list (copy off-machine before leaving):** `handoff/` (this package), `audit/` (incl. `financial-workflow/`, `0018` packet, `fresh-replayable-backup.sh`), `proof/` (4 evidence packs — screenshots cannot be regenerated), `proposals/` (4 files), `growth/` (incl. `screenshots/` — 6 listing-kit screenshots — and `directory-probes-20261025/`), `docs/` (9 production/migration reports), `backup/` (**the only existing production DB dumps**), `qa/` reports, `skills/` (11 team skills), root-level specs (`README.md`, `WORKFLOW.md`, `*BRIEF*`, restock handoffs, `preview-env-*` notes, `ranch-manager-pro-source.zip`), `site/.preview-env`, `site/scripts/`, and `.local/pg/` (image + credential files) if the preview sandbox is wanted. (The `site/` tree itself is recoverable from GitHub @ e40c066.)
4. **The Secrets store** — dies. Export the VALUES for the names in §8 (at minimum `DATABASE_URL`, the Stripe names, `Neon`, `OPENAI_API_KEY`, `RanchManagementPro`, `GH_TOKEN`) into the new host's secret store BEFORE leaving.
5. **The ctonew.io inbox** (owner email) — dies. No references to it exist in the shared docs (grep → none; **LIVE VERIFIED** absence); it is a platform-account feature. Replacement: any mailbox the owner controls; nothing in the app sends email today anyway.
6. **Domain/DNS IF platform-managed** — what the machine shows: both hostnames proxy through **Cloudflare** today; the authoritative DNS/registrar location is **NOT VERIFIABLE FROM THIS MACHINE** (lead is checking the registrar in parallel). If the zone/records were set up inside CTO.new, they die with it — replacement: repoint the A/CNAME records at any registrar or Cloudflare to the new host; the 301 bare→www redirect must then be recreated there.

**SURVIVES (external services — LIVE VERIFIED reachable/authoritative):**
- **GitHub repo** `cowboytroy0319-maker/Ranch-Manager-` (all branches, PRs, CI, and this handoff branch live there).
- **Neon Postgres** `ep-gentle-band-awddfg7l-pooler.c-12.us-east-1.aws.neon.tech / neondb / neondb_owner` — the production data does not depend on CTO.new or this machine (but the password currently lives only in the CTO.new secret store / cto-env-vars.sh — export it!).
- **Stripe** account (products/prices/payment links; express account).
- **GitHub Actions CI** (runs on GitHub infra).

---

## 13. RUNBOOK — RUN THE APP ELSEWHERE (MINIMAL COMMANDS)

```bash
# 0. Prereqs: Bun >= 1.4 (tested here), a Postgres 16/18 server, git.
#    (Node not required; Bun runs dev, build, tests and the server.)

# 1. Code (merge PR #12 FIRST — see below)
git clone https://github.com/cowboytroy0319-maker/Ranch-Manager-
cd Ranch-Manager-/site

# 2. Deps
bun install

# 3. Env (new host's secret store / shell export — never a committed .env)
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/neondb'   # fresh Neon or local PG
export APP_ENV=production                                          # explicit mode
# optional: PORT=3000 (default)

# 4. Migrate a FRESH database (applies db/migrations/*.sql in order, tracked in
#    schema_migrations, each file in one transaction; re-running is a no-op).
#    migrate.ts REFUSES hosted/Neon hosts unless --allow-production is explicit:
bun run db:migrate --allow-production
#    (local scratch instead: DATABASE_URL=postgres://postgres@127.0.0.1:5432/ranch_ci bun run db:migrate)

# 5. Build + deploy-time schema gate (refuses to go live against an unmigrated DB)
bun run build
bun run db:check-schema

# 6. Serve (port 3000; serves dist/client static + SSR; Stripe webhook + CSV routes wired)
bun run start

# 7. Optional data: bun run db:seed (sandbox login seed) / db:seed:demo (fake data) —
#    PREVIEW/SANDBOX ONLY, never against the owner's real database.

# 8. Restore the last production backup if continuing the real data:
#    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prod-<stamp>-clean.sql   (see §6)
```

**Merge order (owner gate):** **PR #12 first** (`feature/financial-expense-linking` @ `e40c066`) — it **fully contains PR #11** (§2), so #11 merges automatically with it and needs no separate merge. Then PR #10 (restock "Total cost paid" — NOT contained in #12) only if the owner wants that UI; #8 (mobile workflow — header notes a duplication decision vs #6), #7 (Vercel preview config — preview-only), #6 (password-reset 0019 variant — **likely superseded**: migration `0019_owner_complimentary_access.sql` is already on main via merged PR #9, commit `ca5f197` — verify supersession before merging). Production migrations 0021+0022 land with PR #12's merge and MUST be applied to the production DB (`bun run db:migrate --allow-production`) before/with the release — the schema gate enforces exactly this.

---

## 14. MISSING ASSETS / SINGLE-COPY RISKS

**#1 gap — production DB backup: STALE + SINGLE-COPY.** The only backup of the production Neon DB is `/home/team/shared/backup/prod-20260930T130638Z-clean.sql` (208,214 bytes, 2026-09-30, restorable — replay-proof exists). It is 5+ weeks old, exists ONLY on this machine, and predates everything since. **Recommended one-command fix (owner-approved):** reinstall Postgres 18 client + scratch (`apt install postgresql-18` or equivalent), then `bash /home/team/shared/audit/fresh-replayable-backup.sh` (writes a fresh self-proving dump to `/home/team/shared/backup/`), then copy that file off-machine. Until then, no current recovery point for the owner's real data exists.

**Everything that exists ONLY on this machine (single-copy; export before leaving):** the full `/home/team/shared` tree per §12 item 3 — specifically: `backup/` (production dumps), `proof/financial-workflow/` (4 packs incl. irreplaceable screenshots), `audit/` (matrix, defect ledger, verifications, 0018 packet, backup script), `proposals/` (4), `growth/` (kit + 6 screenshots + probes), `docs/` (9), `qa/`, `skills/` (11), root specs/briefs, this `handoff/` document (until its branch is pushed — it is being pushed to `handoff/exit-package` in the same session), `.local/pg/` (preview image + credential files), `site/.preview-env`. Secret VALUES (CTO.new Secrets store) are also single-copy at the platform level (§8 warning).

**Work not pushed:** none in the authoritative clone (`/home/engine/work/ranch` clean, HEAD == upstream). The only unpushed state is `/home/work/rmp-restock`'s interrupted-rebase scratch (170 dirty entries, detached HEAD) — no unique work identified; if in doubt export `git bundle create /tmp/rmp-restock.bundle --all` from it before discarding. `/tmp/eng-fin2` (cited as build tree in the matrix) is gone; its commits are all on GitHub.

**Missing entirely (verified absent, 2026-11-08):**
- **No off-machine backup of production data** (§14 #1, §6).
- **No monitoring/alerting** — no sentry/uptime/datadog/newrelic anywhere in `src/` or `package.json` (grep empty); no health checks beyond publish.sh's localhost wait.
- **No upload/file storage** — DB + session rows only (§7).
- **No email provider** — `RESEND_API_KEY` absent; password reset cannot deliver to anyone (proposal (a) unbuilt).
- **No scheduled jobs / cron** (§10) — nothing renews or reminds on its own.
- **No billing capability in Stripe** (express account, 0 subscriptions; homepage still advertises "/mo" — proposal (b) pending owner PR approval).
- **No Postgres tooling on the current machine image** — preview DB and backup tooling both inoperable until reinstalled (§3/§6); the preview image data itself is intact.

---

**CHANGE LOG:** 2026-11-08 — compiled by engineer agent (session for team lead); all LIVE VERIFIED checks dated 2026-11-08 07:31–07:45 UTC; docs-only branch `handoff/exit-package`.
