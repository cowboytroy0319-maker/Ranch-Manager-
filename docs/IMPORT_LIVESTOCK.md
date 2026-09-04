# Livestock CSV Import — Ranch Manager Pro
Scope: **Program Item 3 — safe livestock CSV import** (owner-approved private beta). New-animal bulk import with a staged, preview-before-write flow; never edits an existing animal, never writes outside the session's operation, and records a truthful audit row per import.

## User-facing flow (5 steps, owner-only)
`/onboarding/import` (also reachable from `/onboarding` → "Import existing records" and from the livestock page) — mobile-first, single column, all served by real Postgres once migration `0017` is applied to that database (until then the page shows the designed "Database error" state).

1. **Choose file.** Plain-text `.csv` only — a `.csv` extension OR a `text/csv` / `application/vnd.ms-excel` / `application/csv` MIME type. Excel binaries, PDFs, zips, etc. are rejected up front with a friendly message. Limits: **1 MB max**, **2,000 data rows max** — whole-file reject on either, never partial processing.
2. **Map columns.** Column headers are smart-guessed (case/space/punctuation-insensitive: `Tag`, `Ear Tag`, `Animal ID` → tag_number; `DOB` → birth_date; `Location` → pasture; …). Any column can be remapped or set to "— ignore —". Exactly one column may map to each app field; **tag_number and species are required** for every row.
3. **Review rows (preview-before-write).** The server parses and validates the *entire* file and returns a full review session — per-row status, human reason, values, tag — against the operation's live herd. **Nothing is written at this step** (zero database writes on parse). Every row gets exactly one status:
   | Status | Meaning |
   |---|---|
   | `ready` | Will import (tag + species present, all values valid) |
   | `missing` | Tag or species is blank |
   | `invalid` | Value not in the accepted vocabulary, bad date, or over-length |
   | `dup-in-file` | Same tag appears more than once in THIS file — only the first row imports |
   | `dup-existing` | Tag already exists in this ranch's live herd |
   | `excluded` | Owner toggled the row OFF before confirming |
   Duplicate rows are **skipped, never abort the bulk, never silently imported**; the owner can also toggle any row off (excluded).
4. **Confirm (explicit).** "Import N animals now" only enables when the mapping is valid and at least one ready row is unexcluded. Acknowledgment checkboxes are required when relevant: duplicate-tag rows remaining ("will be skipped — import the rest anyway") and a **same-file previously imported** fingerprint warning ("already imported — import anyway?"). Nothing auto-skips and nothing is silent.
5. **Result.** Imported / skipped-by-status / excluded / total counts, plus a note when the file matches a prior import. "Done — go to livestock" or "Import another file".

## Limits & allowlist (enforced server-side, mirrored client-side for fast feedback)
| Rule | Value |
|---|---|
| File type | `.csv` extension or text/csv-ish MIME only |
| Max size | 1 MB (`IMPORT_MAX_BYTES`) |
| Max data rows | 2,000 (`IMPORT_MAX_ROWS`) |
| Max tag length | 40 chars |
| Max name | 120 |
| Max breed | 60 |
| Max pasture | 80 |
| Max notes | 500 |
| Required per row | tag_number + species |
| Dates | strict `YYYY-MM-DD` and a real calendar date |

## Field mapping (CSV column → app field)
`id` and `ranch_id` are intentionally **not** offered as import fields: imports always create *new* records and `ranch_id` always comes from the authenticated session (never from the file). Accepted enum values come from `src/types/livestock.ts` — the same lists the CSV templates and `saveAnimal` use.

| CSV column example | App field | Required | Accepted values |
|---|---|---|---|
| `tag_number` / `Tag` / `Ear Tag` / `Animal ID` | `tag_number` | ✅ | any non-blank ≤40 chars; normalized (trimmed, interior whitespace collapsed) |
| `species` / `type` | `species` | ✅ | `cattle`, `horse`, `goat`, `sheep` (case-insensitive, stored lowercase) |
| `name` / `animal` | `name` | — | ≤120 chars; defaults to the tag when blank |
| `sex` / `gender` | `sex` | — | `female`, `male`, `castrated`; blank = unset |
| `breed` / `cross` | `breed` | — | ≤60 chars; blank = unset |
| `birth_date` / `DOB` | `birth_date` | — | `YYYY-MM-DD`, real date |
| `acquisition_date` / `purchase_date` | `acquisition_date` | — | `YYYY-MM-DD`, real date |
| `status` / `animal_status` | `status` | — | `active`, `pending`, `sold`, `deceased`, `culled`, `archived`; blank defaults to `active` |
| `pasture` / `location` | `pasture` | — | ≤80 chars (free text name); blank = unset |
| `notes` / `comments` | `notes` | — | ≤500 chars; blank = unset |

Imports never set `herd_group_id` (the CSV vocabulary has no group column) and never touch an existing animal's row.

## Safety model
- **Owner-only.** Both server endpoints call `requireAuth()` and reject roles other than `owner` with a friendly error. The session's `user_id` becomes the audit row's `user_id`.
- **Cross-operation isolation.** Every read/write carries the session `operation_id`: existing tags are read per-operation, inserts write `ranch_id = operationId`, and the audit row is scoped per operation. Tags in Ranch A never collide with Ranch B (tag uniqueness is **per operation**, migration `0013`'s `animals_ranch_tag_uniq`).
- **Preview-before-write.** The parse endpoint reads/validates the whole file and returns the review session with **zero database writes**. The commit endpoint re-reads the *same file bytes* (the client re-reads its `File`) and re-validates the mapping and every row — the server never trusts client-supplied statuses.
- **All-or-nothing transactional commit.** One `db.begin` transaction inserts every ready + not-excluded row and the audit row; any unexpected error rolls everything back (a recorded `completed` audit row is always truthful). A tag that landed in the live herd between preview and commit (the "stale preview" race) fails closed: the unique index fires mid-transaction, the whole batch rolls back, and the owner gets an actionable message to re-run the preview.
- **No raw retention.** File bytes are never stored server-side; the audit table holds only the fingerprint + derived counts.

## Duplicate-file fingerprint behavior (why there's an "Import anyway")
`fingerprintCsv` computes a SHA-256 of the normalized CSV (lines trimmed, blank lines dropped, trailing blank line ignored — so identical content with/without a final newline hashes identically; header + data both count). Before committing, the server looks up the most recent **`completed`** import of the same fingerprint **for this operation**:
- If one exists and the owner did **not** tick the acknowledgment, the commit is refused ("This file looks like it was already imported…") and nothing is written.
- With the acknowledgment, it imports anyway and records a **second truthful audit row** — explicit operator choice, never auto-skip, never silent.

This is deliberately **application-layer only** — there is **no DB unique constraint on fingerprint** (`0017` migration): a unique index would turn the acknowledged re-import into a rollback, which the spec forbids. Within one commit, the app-layer duplicate rows (dup-in-file / dup-existing) are skipped and counted; the *tag* uniqueness inside `animals` is still enforced by the per-operation unique index.

## Audit table (`0017_livestock_imports.sql`)
One row per import attempt (the transaction inserts it; a rolled-back attempt leaves none):

| Column | Notes |
|---|---|
| `operation_id` | FK → operations, ON DELETE CASCADE — scoping key |
| `user_id` | FK → users — who imported |
| `filename` | original upload filename (metadata only; raw bytes never stored) |
| `fingerprint` | SHA-256 of normalized CSV |
| `total_rows` / `imported_rows` / `skipped_rows` / `excluded_rows` | derived counts |
| `status` | `completed` only (CHECK constraint also allows `rolled-back` for future use — nothing is recorded as completed unless it actually committed) |
| `created_at` | timestamptz, default now() |

Indexes: `livestock_imports_operation_id_idx`, `livestock_imports_created_at_idx`. Migration is **NOT applied to the owner's Neon yet** — the lead applies it for separate approval (until then the import page shows the designed "Database error" state).

## Code layout (auth.ts/authServer.ts split)
- `src/types/importLivestock.ts` — shared, JSON-safe types: `ImportField`/`IMPORT_FIELDS`, `ImportColumnMapping`, `ImportRowValue`, `ImportRowStatus`/`IMPORT_ROW_STATUSES`, `ImportReviewRow`, `LivestockImportSession`, `LivestockImportResult`, and the limits.
- `src/server/importLivestock.ts` — **client-safe** public surface (what routes import): pure RFC-4180 CSV reader (`parseCsv`, `parseCsvWithLimits`), mapping guess/validation, row extraction/validation, `rowToAnimalInput`, `buildReviewSession`, and the two `createServerFn` endpoints (`parseLivestockCsv`, `importLivestockCommit`). No `node:`/`~/db` value imports — the browser bundle stays clean.
- `src/server/importLivestockServer.ts` — **server-only**: `fingerprintCsv` (node:crypto), DB readers (`existingTagsForOperation`, `findPreviousImport`), the injectable transactional `commitLivestockImportCore`, and the auth+full-pipeline cores. Lazy-loaded via dynamic `import()` from the handlers.
- `src/routes/onboarding/import.tsx` — the 5-step flow UI; never writes by itself.

## Tests (121 total suite; +45 for this item)
- `src/server/importLivestock.test.ts` — **34 pure** unit tests: RFC-4180 parsing (quotes, CRLF, padding), limits (2,000 exact + 2,001 reject), fingerprint stability, header guessing, mapping validation, per-row status machine (every status, mutual exclusivity, blank-tag no-collision, every enum value passes), review-session end-to-end, normalizeTag/rowToAnimalInput insert shape, csvQuote.
- `src/server/importLivestock.db.test.ts` — **7 DB-backed** (local Postgres only): happy-path commit + truthful audit row, `findPreviousImport`, Ranch A/B isolation (animals + audit + tags), same-tags-in-another-ranch no-collision, duplicate fingerprint gate (refused without `accepted` and writes nothing; re-imports with `accepted`), and the stale-preview race that rolls back fully.
- `src/server/importLivestock.txn.test.ts` — **4 transactional**: preview writes nothing, commit counts excluded rows without writing them, forced unique-violation mid-insert rolls back the entire batch (no partial rows, no audit), and a rolled-back attempt leaves no `completed` audit that could block a later retry.

All DB tests refuse to run unless `DATABASE_URL` contains `127.0.0.1` (the owner's Neon is never used):
```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test bun test src/server/*.test.ts
```

## Gotcha for future DB-test writers (postgres.js array return)
`postgres.js` returns **arrays of row objects**, not scalars — and its TypeScript generic is `T extends readonly (object | undefined)[]`. A count query must be declared as an array type and the value read off the first row:

```ts
// WRONG — TS2344 + TS1320:
// const [n] = await db<{ n: number }>`SELECT count(*)::int AS n FROM animals …`;
// (…`{ n: number }` doesn't satisfy the array constraint, and the count row has a callable `then` member)

// RIGHT — declare the row array and read count[0].n:
const counts = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opId}`;
expect(Number(counts[0].n)).toBe(4);
```

Same pattern for `RETURNING` inserts: `const [row] = await db<[{ id: number }]>`INSERT … RETURNING id``.