# Onboarding + Downloadable Templates — Ranch Manager Pro

Scope: **Program Item 2 — Customer onboarding + templates** (templates ONLY — import
is a later item and is deliberately **not** built here). No export/import parsing,
no offline saving.

## Flow

1. **Registration routes to onboarding.** `register` page navigates a new owner to
   `/onboarding?new=1` after the account + operation are created (the operation is
   named by the ranch name field at registration).
2. **Existing users who haven't finished setup see a progress card.** The Daily
   Operations dashboard loads `getOnboarding` and renders `SetupProgressCard`
   ("Finish ranch setup — N of 5 steps done") until setup is complete; the card
   links back to `/onboarding`.
3. **Onboarding page (`/onboarding`)** — mobile-first, one column, full-width
   inputs, large tap targets, `inputMode="decimal"` numeric keyboard for acres:
   - Name (prefilled from `operations.name`, editable via `renameOperation`)
   - Location (optional)
   - Primary operation type (enum: `cattle`, `mixed_livestock`, `horses`,
     `crops_farm`, `mixed_ranch_farm`)
   - Approximate ranch/farm acres (optional, positive decimal, server-validated)
   - Primary species / focus (optional; datalist suggestions `cattle`, `horses`,
     `goats`, `sheep`)
4. **Three clear choices:** "Start fresh" (→ dashboard), "Import existing
   records" (→ `/onboarding/import`, a clearly-marked **coming soon** placeholder —
   no import functionality), "Download templates" (→ `/onboarding/templates`).
5. **Never traps the user.** "Skip for now" / "I'm done — go to dashboard" are
   always visible; the bottom nav (Dashboard | Tasks | Quick Add | More) is
   present on every authenticated page, so skipping leaves the app fully usable.
   Partial saves are persisted (`saveOnboarding` upserts the profile row), so the
   owner can resume later and the fields are editable any time.

## Fields / setup checklist (5 steps)

| Step | Field | Where | Notes |
|---|---|---|---|
| 1 | Ranch/operation name | `operations.name` | Always present from registration; editable on `/onboarding` |
| 2 | Primary operation type | `operation_profile.operation_type` | Enum above, CHECK-constrained |
| 3 | Ranch/farm acres | `operation_profile.acres` | Positive decimal, `CHECK (acres IS NULL OR acres > 0)` |
| 4 | Primary species / focus | `operation_profile.primary_species` | Free text (suggestions provided) |
| 5 | Templates downloaded | `operation_profile.templates_downloaded` | Set true on any template download |

Progress shown on the card: `done = 5 - missing`. Name (step 1) counts as done
from registration. Setup is **complete** when all 5 steps are satisfied; the
dashboard card hides when complete (`onboarding_completed_at` is stamped by
`finishOnboarding`).

## Data model (migration `0016_operation_onboarding.sql` — additive, nullable)

- `operation_profile` — one row per operation (`operation_id UNIQUE`, FK →
  `operations` ON DELETE CASCADE). All columns nullable except
  `templates_downloaded` (default false). Rows are written ONLY with an explicit
  `operation_id` and read/written ONLY via the onboarding server functions,
  scoped by the authenticated operation (owner). No Default-Operation fallback.
- `operations.onboarding_started_at` / `onboarding_completed_at` — nullable
  timestamps driving the dashboard card visibility.

## Server functions (`src/server/onboarding.ts`)

All are `createServerFn` (POST where they write), call `requireAuth()` first, and
scope every query by `auth.operationId`:

- `getOnboarding()` — reads profile + operation row for the session operation.
- `saveOnboarding()` — upserts the profile (INSERT with explicit operation_id /
  `ON CONFLICT (operation_id) DO UPDATE`), stamps `onboarding_started_at`, returns
  fresh state.
- `renameOperation()` — renames the operation row scoped by id.
- `finishOnboarding()` — stamps `onboarding_completed_at` (idempotent).
- `markTemplatesDownloaded()` — flips the templates step (insert-if-new /
  update-if-exists, operation-scoped).
- `getTemplateCsv()` — authenticated download endpoint: validates the slug,
  returns `{ ok, slug, filename, csv }`.

Injectable `*Core` functions expose the exact SQL shapes for local-DB tests
(same pattern as `authServer.registerCore`).

## Templates (`src/types/onboarding.ts` `TEMPLATES` + `buildTemplateCsv`)

Six CSV templates: **livestock, pastures, hay-feed, equipment, expenses, tasks**.
Each file is:

- a `#` header comment line listing the accepted values,
- a **header row** with the app's exact field names,
- **one example row** (delete before use),
- a `# FIELD DEFINITIONS` legend block with a plain-language explanation of every
  column (what the app accepts, which are required).

Fields and enums match the real tables/server parsers exactly:

| Template | Header fields | Accepted enum values |
|---|---|---|
| livestock | `tag_number, name, species, sex, breed, birth_date, status, pasture, notes` | species `cattle\|horse\|goat\|sheep`; sex `female\|male\|castrated`; status `active\|pending\|sold\|deceased\|culled\|archived` |
| pastures | `name, size_acres, location, status, soil_type, notes` | status `grazing\|resting\|idle\|maintenance` |
| hay-feed | `type, quantity, unit, bale_weight, source, storage, acquired, low_stock, notes` | type `grass\|alfalfa\|mixed\|other`; unit `bales\|tons` (hay) / `lbs\|bags\|tons` (feed) |
| equipment | `name, category, make, model, year, hours, miles, location, fuel_type, notes` | category `truck\|tractor\|trailer\|implement\|atv\|stationary\|other`; status `in-service\|maintenance-due\|out-of-service`; condition `excellent\|good\|fair\|poor`; fuel `diesel\|gasoline\|gas\|electric\|other` |
| expenses | `category, amount, date, vendor, job, notes` | category `feed\|vet_health\|maintenance\|insurance\|fuel\|other` |
| tasks | `title, status, priority, due_date, category, notes` | status `to_do\|in_progress\|completed\|canceled`; priority `low\|normal\|high\|urgent`; category `livestock\|feed/hay\|pasture\|fencing/water\|equipment\|crops/farm\|paperwork\|general` |

- **CSV text only** — no macros, no formulas, no hyperlinks, no PII. The field
  legend lives inside each file (header comment + definitions block).
- Downloading is a **real browser download**: the authenticated server fn returns
  the CSV; the client creates a `Blob` and clicks a temporary `<a download>`
  anchor (`src/components/onboarding/download.ts`). No raw URLs are exposed.

## Limits / guardrails

- `acres` ≤ 99999 and > 0 (server-validated; DB CHECK backs it up).
- Name ≤ 80 chars, location ≤ 120, species ≤ 80.
- Operation type must be in the enum — unknown values are rejected, never
  silently defaulted.
- No offline saving is claimed; nothing is stored client-side except ephemeral
  UI state.
- Templates exist for download only — there is no import/export parser. The
  "Import existing records" choice shows the coming-soon placeholder.

## Tests (`src/server/onboarding.test.ts`)

Runs against the local `ranch_tasks_test` DB (same skip-if-not-local guard as the
other suites — never Neon): validation, checklist math, save/update scoped to the
right operation, cross-operation isolation (Ranch B cannot read or update Ranch
A's profile — the scoped UPDATE affects zero rows), template downloads require
auth (server fn path), and template content matches the accepted enum values
(pure assertions importing the same type constants the app uses).