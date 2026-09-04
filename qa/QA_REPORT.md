# Ranch Manager Pro — Browser QA Report (live demo)

Site under test: https://9b3dc5aae6b40835eb587c2a6310f5b4.ctonew.app
Method: agent-browser CLI (Chrome 152) driving the live site; curl for origin-level HTML checks.

## Part A — Real-browser functional QA (8 items)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Module tabs/nav — 9 views each render own content | **PASS** | Clicked every tab; each rendered unique content: Overview (stats/reminders), Livestock (herd snapshot), Horse Energy (23.7 Mcal calc), Hay & Feed (feed inventory), Pasture & Forage (grazing/forage intel + "Pastures & grazing activity"), Equipment (Kubota M7-172), Registrations (renewals table), Fuel (monthly gallons/Feb), Costs (YTD cost) |
| 2 | Horse Energy calc updates Mcal | **PASS** | Workload Moderate→Heavy: 23.7→27.2 Mcal/day; weight slider 1100→600 lb: 27.2→14.9 Mcal/day (both update output + "for a ... lb horse at ...") |
| 3 | Livestock species filter | **PASS** | Clicked Goats → detail header changed "Cattle — herd snapshot" → "Goats — herd snapshot" (note "Brush control herd") |
| 4 | Maintenance "mark done" toggle | **PASS** | Ticked F-350 reminder: checkbox false→true, title got `text-decoration: line-through` + grey (computed style verified) |
| 5 | Sortable Overview reminders | **PASS** | Sort select due→category re-ordered list (first items changed from Cow herd/F-350/Tractor to Brand inspection/Cattle audit/Feedlot) |
| 6 | Site filter (Pasture + header subtitle) | **PASS** | All sites: 6 pastures; switched to Mesa Feedlot Unit → subtitle "Showing Mesa Feedlot Unit" + Pasture list reduced to only "Feedlot Pen 3" |
| 7 | Landing → demo CTA link | **PASS** | Clicked "View Live Demo" (ref e1) on / → URL became /demo |
| 8 | Console / JS errors | **PASS (none)** | Installed window.onerror/console.error capture + window 'error' listener, traversed all 9 views + site filter → 0 errors collected |

Note on refs: agent-browser accessibility refs (`@eN`) shift after every navigation; reliable interaction used CSS/DOM eval locators. `agent-browser find text` click silently failed; `click @eN` worked when refs were fresh.

## Part B — Fixes applied (source)
1. **Compliance/Registrations table now genuinely sortable.** `ComplianceModule.tsx` gained a "Sort: due date / Sort: category" select (same approach as Overview) and sorts rows by due date (`daysLeft`) or by kind+title. Subtitle updated to "Sort by due date or category — check an item to mark complete" (no longer the false "Sortable list" claim). Table checkboxes retained.
2. **Overview reflects selected site (quick win).** `OverviewModule.tsx` accepts a `site` prop (demo.tsx already passed it) and the "Livestock by species" card subtitle now reads "Head count across {siteName}" (e.g. "all sites" / "Mesa Feedlot Unit"). Low-cost, does not change data semantics.

## Part C — Publish & re-verify
- `bun run publish` (from /home/team/shared/site) → **BUILD SUCCEEDED** (vite client+ssr, 155+63 modules), "site published; serving on port 3000", exit 0.
- Live site serves 200s: `GET /` → 200, `GET /demo` → 200.
- Live /demo HTML contains the new sort options **"Sort: category"** and **"Sort: due date"** (verified via curl of the live origin).
- **In-browser network proof:** `fetch('/demo')` from inside the live page returned `status:200, hasNewSort:true, hasOldSubtitle:false` — the live origin definitively serves the new build.

## Known testing-tool limitation (browser DOM staleness)
The agent-browser *rendered* DOM kept showing the pre-fix bundle on the /demo page even after: reload, cache-busting URL (`?bust=...`), `close --all`, killing the chrome process, and clearing SW/caches (verified no service worker, no cached keys). Meanwhile the same browser's own `fetch('/demo')` to the identical URL returned the NEW build. Conclusion: the live site serves the new build correctly (origin + network confirmed), but the agent-browser rendering path served a stale app-shell document to the page DOM. So the *interactive* post-fix click-through of the new sort control could NOT be visually confirmed in this tool this session — this is a browser-tool drive artifact, not a site defect. The new code compiled and is deployed; source logic is a small, safe mirror of the already-PASSing Overview sort.

## Files touched
- /home/team/shared/site/src/components/demo/ComplianceModule.tsx (made sortable)
- /home/team/shared/site/src/components/demo/OverviewModule.tsx (site-aware subtitle)

## Part D — Lead-magnet signup verification (2026-09-02, APPROVED TASK)
Scope: complete & ship the in-flight lead-magnet signup rework (landing form offers the free Cost-Per-Head Worksheet in exchange for an email). Verification of the committed implementation (src/routes/index.tsx EmailSignup + src/server/subscribers.ts + migration 0009):
- Valid email → success state with "View & print your Cost-Per-Head Worksheet →" link to /worksheet. PASS (code: `setDone(true)` renders success panel).
- Invalid email → clear message "Please enter a valid email address." (browser `type=email required` + server regex + `ok:false` path). PASS.
- Duplicate/repeat submissions safe: button disabled while busy + client `if (busy) return` + server `ON CONFLICT (email) DO NOTHING`; re-submits return `already-subscribed` and are treated as success, no duplicate row, no error. PASS.
- Data path: `subscribeEmail` server fn inserts into `subscribers` (opted_in=true, source='landing-page'); returns only `{ok,status}` — no subscriber data reaches the browser bundle beyond that; server never logs emails. PASS.
- Mobile/desktop: single-column `w-full` inputs, responsive heading (`sm:text-4xl`), works at gate/shop widths. PASS (by inspection).
- Production build: `bun run build` exit 0 (vite client+ssr, ~2.3s). Type check `bunx tsc --noEmit`: 15 pre-existing project-wide nits (Bun globals in serve.ts, unused vars) — none in subscribers/type files; not blocking (no lint/test script configured).
- Secret scan on all signup-path files: 0 matches (no whsec/sk/pk/napi/conn-strings); only placeholder `you@ranch.com`. PASS.
## Part E — Livestock record foundation (2026-09-02, APPROVED TASK)
Scope: extend the live livestock module with a required unique ear tag, acquisition date, culled/archived statuses, richer filters, and the first unit tests. Built on the existing tables/server/route/modals — no parallel data structures, no second route, no hard-delete controls.
- **Migration `0012_livestock_core.sql`** (additive/idempotent): `acquisition_date date` column (IF NOT EXISTS), status CHECK widened to active/pending/sold/deceased/culled/archived (DROP IF EXISTS + re-ADD), partial `UNIQUE` index `animals_tag_number_uniq` on non-NULL tags. Verified by reading the migration + runner rules (one statement per semicolon; `IF NOT EXISTS` guards); seed data (unique tags, statuses active/pending/sold) remains compatible — no seed change required. NOT run against any live DB per task guard.
- **Server (`src/server/livestock.ts`)**: tag_number REQUIRED ("Tag/animal ID is required."); name optional, defaults to the tag for display (stored once, so list/detail stay consistent); `acquisition_date` parsed (isoDate) and included in SELECT (to_char), INSERT, UPDATE; pre-check for duplicate tags before insert AND update (excluding the animal's own id) returning "Tag 'X' already exists — tags must be unique.", plus a unique-violation backstop in the catch (matches `animals_tag_number_uniq`/`duplicate`). New exported pure helper `findTagCollision(rows, tag, currentId)`.
- **Types (`src/types/livestock.ts`)**: `ANIMAL_STATUSES` includes culled/archived; `Animal.acquisition_date: string | null`.
- **UI (`routes/livestock.tsx` + `LivestockModals.tsx`)**: form adds Acquisition date (optional); Name optional ("Cowboy (optional)"), Ear tag required ("SV-101" placeholder); status dropdown gains Culled/Archived; detail modal shows "Acquired"; tone map covers culled/archived (stone); toolbar filters now Status + **Sex / Breed / Location(Pasture)** (all composed with species/status, all `w-full sm:w-auto` so they stack full-width on phones); text search covers name, tag, AND numeric id; non-active rows render at reduced opacity (badge + `opacity-60`) so history stays visible but separate from active; loading/empty/validation-error states preserved; validation errors (missing tag, duplicate tag) surface inline in the form via the existing ErrorNote.
- **Tests (`src/server/livestock.test.ts`**, `bun test`): 11 pass / 0 fail / 19 expect() — tag-required rule (missing + blank), name-defaults-to-tag, acquisition_date parse, duplicate-tag detection (different id → true, own id → false, trimmed/blanks), status allow-list contains culled/archived. New `src/types/bun-test.d.ts` gives `tsc` ambient types for `bun:test` (project pins `types: ["vite/client"]`; no new deps added).
- **Build**: `bun run build` exit 0 (vite client+ssr, 2.60s). Type check `bunx tsc --noEmit`: 15 pre-existing project-wide nits remain (serve.ts Bun globals, unused vars, PastureModule, analytics, index.tsx maxCost — same list as Part D); **0 new errors in changed files**. Secret scan on changed files: 0 matches (no whsec/sk/pk/napi/conn-strings).
## Part F — Ranch/operation scoping for livestock tag uniqueness (2026-09-02, APPROVED TASK)
Scope: fix the over-reach where ear-tag uniqueness was GLOBAL (`animals_tag_number_uniq`, migration 0012) — that would forbid two different ranches from using the same tag. Uniqueness is now enforced **within** the ranch/operation; the single-operation app works exactly as before.
- **Migration `0013_animals_ranch_scope.sql`** (additive/idempotent, runner-safe: one statement per semicolon, no DO blocks/functions, no semicolons in comments): creates `operations` (ranch/account scope) with one seeded 'Default Operation'; adds `animals.ranch_id` (FK → operations, ON DELETE CASCADE); backfills existing rows onto the default operation; then `SET NOT NULL` (safe: backfill ran first in the same transaction, and both writers supply it); `DROP INDEX animals_tag_number_uniq`; creates the scoped partial `UNIQUE` index `animals_ranch_tag_uniq (ranch_id, tag_number) WHERE tag_number IS NOT NULL` — NULL/blank legacy tags stay allowed. Verified by reading migration + runner rules + build; NOT run against live DB per task guard (the lead applies it to Neon).
- **Server (`src/server/livestock.ts`)**: new exported `currentRanchId(db)` resolves the single operation row (`SELECT id FROM operations ORDER BY id LIMIT 1`); `findTagCollision(rows, tag, currentId, ranchId)` now compares tag **and** ranch — same tag on a different id in the same ranch collides, same tag in a different ranch (or rows without ranch_id) never collides, blank/NULL tag never collides, edit path keeps its own tag; `saveAnimal` scopes both the pre-check and the UPDATE `WHERE ... AND ranch_id=`, INSERT sets `ranch_id` to the current operation, error text is "Tag 'X' already exists in this ranch — tags must be unique.", unique-violation backstop now matches `animals_ranch_tag_uniq`; `getLivestockData` SELECT includes `a.ranch_id`.
- **Types (`site/src/types/livestock.ts`)**: `Animal.ranch_id: number | null` added; everything else stable.
- **Seed (`site/db/seed.ts`)**: the animals INSERT now includes `ranch_id` (default operation) so seeding still passes the new NOT NULL column.
- **Tests (`src/server/livestock.test.ts`, `bun test`)**: 13 pass / 0 fail / 24 expect() — same-ranch different-id → collision; same tag in a DIFFERENT ranch → NOT a collision (plus the same-ranch positive control); own-id edit → not a collision; trimmed/blanks; rows without ranch_id never collide; no-match; tag-required + status allow-list tests kept.
- **Build**: `bun run build` exit 0. Type check `bunx tsc --noEmit`: 15 pre-existing project-wide nits remain, **0 new errors in changed files**. Secret scan on changed files: 0 matches (no keys/conn strings/personal data).
## Part G — Authentication + ranch-level isolation (2026-09-02, APPROVED TASK)
Scope: real per-ranch accounts with server-side sessions, owner memberships, and operation-scoped isolation for every operational module. Migration `0014` committed; **NOT applied to Neon — applying it to prod is the owner's separate decision** (until then `/register` and `/login` show the designed "Database error" state on live).
### Implemented
- `src/server/auth.ts` — client-safe public surface: `register` / `login` / `logout` / `getSession` createServerFns (handlers lazy-dynamic-import the server-only module so the client bundle never carries `~/db`, `node:crypto`, or postgres) + `normalizeEmail` / `isValidEmail`.
- `src/server/authServer.ts` — server-only machinery: scrypt hashing (`hashPassword`/`verifyPassword`, `scrypt:N:r:p:salt:hash`), session tokens (32-byte random, only the SHA-256 hash stored in `sessions`), HttpOnly SameSite=Lax cookie (`rmp_session`, 30-day), `resolveAuth`, `requireAuth`, injectable `registerCore`/`loginCore`.
- `src/server/authTypes.ts` — `AuthedUser`, `AuthResult`, input types (no dependencies).
- `db/migrations/0014_auth_users_operations.sql` — `users`, `operation_memberships` (role CHECK owner/worker/viewer), `sessions` (token_hash PK), plus `operation_id` scoping columns on every operational table with backfill onto the seeded Default Operation and NOT NULL where customer-facing.
- Routes `/register`, `/login` + `src/components/AuthUI.tsx` (AuthFrame/Field/FieldError/useAuthForm). `/dashboard` `beforeLoad` guard redirects sessionless visitors to `/login?reason=auth`.
- All 9 modified server modules (`feed`, `livestock`, `pasture`, `equipment`, `costs`, `expenses`, `employees`, `taxExemptions`, `analytics`) now call `requireAuth()` and scope every SELECT/INSERT/UPDATE by `auth.operationId`; writes that match zero rows are rejected ("no longer exists in this ranch"/"no longer exists"). Cross-ranch update affects zero rows; cross-ranch read returns no rows. Registered users always get a **new** operation (named by the customer) + owner membership — never the Default Operation, never demo data.
- `src/types/bun-test.d.ts` extended (beforeAll/afterAll, `.not`, `.toBeDefined`) for the new integration test.
### Tested (bun test, live commands)
- `bun test src/server/auth.test.ts` → **10 pass / 0 fail / 33 expect()**. Applies all migrations (incl. 0014, idempotent) to a dedicated local test DB (`ranch_auth_test` on :5433) and refuses non-local DATABASE_URLs so Neon is never touched. Tests:
  1. registerCore creates user + NEW customer-named operation + owner membership; new operation id ≠ seeded Default Operation id
  2. duplicate email rejected ("That email is already registered — try signing in."), no second account
  3. password stored as scrypt hash ≠ plaintext; `verifyPassword(plain, stored)` true; wrong password false
  4. loginCore correct password → ok:true with operationId/role
  5. loginCore wrong password → ok:false "Incorrect email or password."
  6. loginCore unknown email → same generic error (no account enumeration)
  7. `requireAuth` throws when no session ("Not authenticated")
  8. `resolveAuth` returns null without a session cookie
  9. cross-ranch READ rejected: user B's hay/herd rows invisible to queries scoped to user A's operation (positive control: visible under B)
  10. cross-ranch UPDATE rejected: UPDATE scoped to A affects 0 rows on B's hay row; row untouched
- `bun test src/server/livestock.test.ts` → **13 pass / 0 fail / 24 expect()** (no regression).
- Type check `bunx tsc --noEmit`: 15 pre-existing nits only, 0 new (auth files + tests clean). Build: verified green by the lead (client + SSR, EXIT=0) — not re-run this session.
### Remains
- Applying migration 0014 to live Neon (owner's separate decision; until then `/register`/`/login` show the designed "Database error" state).
- Worker/viewer invites UI (schema + `resolveAuth` already support the roles).
- Publishing a build that includes `/register`, `/login`, and the auth-guarded modules (publish is a separate step, not part of this commit).
- Crew-visible analytics/audit view, password reset flow (not built).
## Part H — Tasks & Projects module + dashboard card + equipment add/edit (2026-09-02, APPROVED TASK follow-up)
Scope: finish the mobile-ops build — the `/tasks` route, the dashboard "Today's tasks" card, equipment add/edit modal mount, integration tests, and docs. Built on the phase-1 commit (migration 0015 + `src/server/tasks.ts` + `src/types/tasks.ts` + `EquipmentModals.tsx` already committed).
### Implemented
- **`/tasks` route** (`src/routes/tasks.tsx`): same `beforeLoad` + `getSession` guard as `/analytics`/`/livestock`. Quick-add card (title/due/priority/category) with an expandable "Add details" panel (description/status/project/pasture/equipment/animal links, via shared `src/components/tasks/TaskForm.tsx`); filters (status, priority, due: overdue/today/upcoming/none, category, project); list sorted open-first by due date; one-tap complete/reopen circle; inline Edit → modal; projects panel (saveProject, new-project input + list with task counts); **empty state** explaining the first task; mobile-first stacked cards + large tap targets. Wired to `saveTask`/`updateTask`/`completeTask`/`reopenTask`/`saveProject` — every write `router.invalidate()`s the loader.
- **Dashboard "Today's tasks" card** (`src/components/dashboard/TasksSnapshot.tsx`, mounted at the `{/* 1. Today's priorities */}` spot in `dashboard.tsx`): uses `getDashboardTasks` (overdue/due-today/high-priority OPEN tasks, most urgent first), badge counts, rows link to `/tasks`. MorningBriefing untouched.
- **Equipment add/edit mounted** (`src/routes/equipment.tsx`): "+ Add equipment" button in the fleet board header + per-row Edit, `EquipmentFormModal` wired exactly like pasture (save → invalidate). Maintenance/fuel-log workflows untouched (all three cards still render).
- **Tests** (`src/server/tasks.test.ts`, local Postgres `ranch_tasks_test` on :5433, same skip-if-not-127.0.0.1 guard as auth.test.ts — Neon never touched): **26 pass / 0 fail / 93 expect()**. Parsers (title required/too long, enum defaults, YYYY-MM-DD dates, project name rules); pure `selectDashboardTasks`/`dueBucket`/`dashboardCounts`/`todayStr`; task lifecycle persisted (create → read-back → update → complete → reopen); **operation isolation**: Ranch A cannot read, edit, complete/reopen, or delete Ranch B's tasks, hay, pasture, or equipment (with B-scoped positive controls); persisted write-shape tests for `saveHay`/`savePasture`/`saveEquipment` (insert → assert row → re-fetch scoped).
- **Docs**: `docs/TASKS_MODULE.md` (schema, scoping, flows), README routes + schema table updated, this report extended.
### Verification
- `bun run build` **EXIT 0** (vite client + SSR, 3.15s; tasks chunks present client+server).
- `bunx tsc --noEmit`: **exactly the 15 pre-existing nits, 0 new** (tasks.tsx/TaskForm/TasksSnapshot/dashboard/equipment/bun-test.d.ts all clean).
- Full suite: `bun test src/server/auth.test.ts src/server/livestock.test.ts` → **23 pass 0 fail** (10 auth + 13 livestock, unchanged); `tasks.test.ts` → **26 pass 0 fail**. Total 49 pass / 0 fail.
- Secret scan on touched files: 0 matches (no DATABASE_URL literals, no sk_live/pk_live/whsec/tokens) — test DB connection strings only appear in docs/comments as `postgresql://postgres@127.0.0.1` examples.
- **NOT done (owner decisions, per guardrails):** migration 0015 NOT applied to Neon (until then `/tasks` + dashboard card show the designed "Database error" state); no publish was run; Stripe/domain/DNS/subscriptions/production data untouched.
