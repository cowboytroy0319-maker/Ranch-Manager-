# QA Report — Product Blocker Release (Part B2)

Branch `feature/product-blocker-data`. Local verification only — nothing here
was run against production data, and no migration was applied to the live
database.

## What was tested and real results

| Check | Result |
| --- | --- |
| `bun test` (full suite, local Postgres on 127.0.0.1:5433) | **219 pass / 0 fail** |
| `bunx tsc --noEmit` | **15 known pre-existing nits** (serve.ts, CalendarSnapshot, MorningBriefing, PastureModule, demoSites, analytics, index maxCost) — **0 new** |
| `bun run build` | **exit 0** |
| Secret scan (code + doc files; PNGs are rendered screenshots, binary, no secrets by construction — paths committed, contents greppable) | **clean** |
| db:seed on the local `ranch` DB | runs green and idempotent after the operation-scope fix (see "Fixes made during QA") |

Covered by the automated suite (server cores, real local Postgres): operation
scoping of every new write (restock, restock edit/delete, pasture activity,
move, expense edit/delete); expense validation (amount > 0, payee required,
category required); restock with cost → exactly one linked expense; restock
without cost → zero expense; retry with the same `client_request_id` →
duplicate detected, nothing re-applied; restock edit → linked expense
upserted/removed correctly; restock delete → expense removed + inventory
reversed; linked-expense delete blocked; move writes history, closes+opens
assignment, rejects self-move / cross-operation ids / negative head count;
templates CSVs customer-safe with relative `/login?reason=auth` redirect and
the 12 expense categories.

## Mobile screenshots (real data, 390×844)

Captured with a real browser against a build of this branch served on a
scratch port with the seeded local `ranch` database (Postgres on 127.0.0.1:5433)
— real seeded records, not mockups or blank states:

- `qa/screenshots/expenses.png` — Expenses list: 12 seeded rows, category
  filter with all 12 categories, ＋ Add expense, cost-allocation section.
- `qa/screenshots/restock.png` — Restock hay/feed modal, low-stock hay item
  preselected, quantity/cost/vendor filled.
- `qa/screenshots/pasture-detail.png` — North River Pasture detail: assigned
  herd, actions (Record activity, Move group, Update condition/water).
- `qa/screenshots/record-activity.png` — Record activity modal (10 activity
  types, cost, "Record as expense" checkbox on by default).
- `qa/screenshots/move-group.png` — Move group modal (group select, destination
  pasture, date, head count, notes).

QA-method note: at 390px the pasture board table horizontally scrolls, so
automated taps on off-screen row buttons needed the row scrolled into view
(manual phone taps are unaffected — the table scrolls with a finger). The
`/pasture?open=<id>` detail deep link does not open the detail when the
pasture list loads asynchronously after mount — logged as a minor known issue
below (tap-path works).

## Inventory-safety behavior (exact, as built)

The rule: **a correction that would push stock below zero is rejected and
nothing is changed.** The check happens *before* any write inside the
transaction, so a blocked edit/delete leaves inventory, the restock log, and
any linked expense exactly as they were. The user-facing message is:

> "This correction would take the stock below zero — some units have already
> been used. Nothing was changed."

Specifics:

- **Edit a restock downward** (new quantity would make `current + (new − old) <
  0`): rejected with the message above; nothing changed. Upward/cost edits
  apply the exact delta (no clamping) and upsert the linked expense.
- **Delete a restock** whose quantity exceeds current stock: rejected with the
  same message; nothing changed. Otherwise the delete reverses the exact
  quantity, removes the linked expense, and removes the log row in one
  transaction.
- Stock that was already fed out therefore cannot be "un-recorded" by deleting
  an old restock — the books stay honest.
- **Audited inventory-adjustment design (noted in code, NOT built):** the
  deliberate decision is documented at the reversal site in
  `src/server/feed.ts` (`deleteRestockCore` DESIGN NOTE): a future
  inventory-adjustment record would carry the adjustment date, a signed delta,
  a required reason (shrink, miscount, spoilage), and operation scope, written
  as its own audited row (who/when/why + resulting level). No table or UI
  exists yet; until then, below-zero corrections stay blocked with a
  plain-language message instead of being silently clamped.

## Owner phone test (≤8 steps, tap-by-tap)

Sign in, then:

1. **Expenses → ＋ Add expense**: pick a category, enter an amount and
   "Payee / description", save → the row appears in the list marked "manual".
2. **More → Hay & Feed → Restock** on a hay stack: enter quantity **and** a
   total cost, save → message "Inventory updated and expense recorded."; on
   hand goes up **and** the Expenses list now shows a "↳ hay restock" row.
3. **Restock again** on the same stack with the cost left **blank** →
   "Inventory updated — no expense created (no cost entered)."; on hand goes
   up, no new expense row.
4. **Edit** the restock from step 2 (raise the quantity) → on hand increases
   by exactly the difference and the linked expense amount follows the edit.
5. **Try deleting a restock bigger than the stack's on-hand** (e.g. delete an
   old large restock after most of it was fed) → blocked with "This correction
   would take the stock below zero — some units have already been used.
   Nothing was changed."; inventory and expenses are untouched.
6. **Pastures → tap North River Pasture → 📋 Record activity**: pick Fencing,
   enter a cost, leave "Record as expense" checked, save → the activity
   appears in the detail timeline **and** the Expenses list shows a
   "↳ pasture activity" row for it.
7. **Back on the detail → 🐄 Move group**: pick the group, a destination
   pasture, save → the detail now shows the new pasture as current, and the
   movement history records from → to with the date.
8. Re-open **Expenses** and confirm the "↳ hay restock" and
   "↳ pasture activity" rows are there, and that deleting one is blocked with
   the "undo that record" message.

## Known issues / remaining UI items

1. `/pasture?open=<id>` deep link doesn't open the detail when the list loads
   async after mount (tap path works). Minor; fix post-release.
2. ~~The pasture board is a wide table inside a horizontal-scroll container at
   phone widths~~ **FIXED in C2:** below md the board renders a phone-safe card
   list (see `qa/screenshots/pasture-cards.png`); the desktop table returns at
   md+. The `/pasture?open=<id>` deep-link nit (#1) remains.
3. Restock history view (restock_log list in the UI) is optional per spec and
   not built this release — the data is recorded.
4. Per-animal pasture is free text and not synced by group moves (documented
   in `docs/PASTURE_OPERATIONS.md`).

## Fixes made during QA

- `db/seed.ts`: the seed predated operation-scoped tables (migration 0014+ made
  `operation_id` NOT NULL across module tables) and 0018's new expense
  categories — seeding failed outright on a fresh DB. Fixed: every seed insert
  now carries the default operation id, and the seeded expense categories use
  the current 12-value set. Seed is green and idempotent again.

## C2 (owner change request #2, final session) — correction UI, mobile cleanup, CI
### Activity correction (Edit / Delete) — exact behavior
- **Duplicate create**: the activity form generates ONE idempotency key per
  form-open; a second submit with the same key (e.g. double-tap) hits the
  server's dedupe and returns `duplicate:true` — no second activity row, no
  second expense. The UI surfaces the server message **verbatim**:
  "Already recorded — activity and expense unchanged." DB unique index on
  `pasture_activities.client_request_id` is the race backstop.
- **Edit** (✏️ on a timeline row): opens the activity form in edit mode with
  date/type/notes/cost/"Record as expense" editable; saves via
  `updatePastureActivity` (absolute values, retriable). The linked expense
  FOLLOWS the activity per server rules — upserted when cost>0 AND the box is
  checked (amount/date/pasture/notes follow), removed when cost is blank/0 or
  the box is unchecked. There is **no separate expense editing**. Flash states
  which happened ("…the linked expense now matches it." / "…its linked expense
  was removed.").
- **Delete** (🗑 on a timeline row): explicit confirmation — "Delete this
  activity and its linked expense?" with the exact behavior spelled out (both
  go together in one step, can't be undone; a no-cost activity notes only the
  activity record is removed). Confirms via `deletePastureActivity` — activity
  AND linked expense removed in one transaction; a repeat returns the plain
  already-removed outcome, never a raw error.
- Verified by the C1 data-layer tests in `productBlocker.test.ts` (duplicate
  create, edit upsert, cost-clear removal, unchecked removal, delete,
  delete-twice safety) — 230 pass / 0 fail.
### Linked-expense rows (expenses)
- Linked rows (source_type restock / pasture_activity) no longer render a
  Delete button (or Edit). They show the source label ("↳ hay/feed restock" /
  "↳ pasture activity") plus a source-management action link — "Open in Hay &
  Feed" (/feed) or "Open in Pasture" (/pasture?open=<id>, module fallback).
  Manual rows keep Edit + Delete + confirmation. Verified in
  `expenseUI.test.ts` + row markup (`!r.linked` guards both buttons).
### Pasture board on phones
- Below md (375/390px) the board renders a card list: name, acres, group,
  condition, water, 21-day grazed/rest tallies, and a full-width "View / manage"
  button (≥44px) — no horizontal swipe to reach any action. The desktop table
  returns at md+. "Download starter templates" links verified reachable in every
  empty state: shared `TemplatesLink` renders `inline-flex min-h-11` (44px) at
  all widths; present in livestock/pasture/expenses empty states (markup-checked).
### CI (owner blocker #4) — GREEN
- `.github/workflows/ci.yml` on pull_request: setup-bun → bun install →
  postgres:16 service container → `bun run db:migrate` against it → `bun test`
  → `bun run build` → guarded typecheck (after the build — see below).
- **Fix 1 — test step was dying on the local-only guard:** every DB-backed test
  file refuses to run unless `DATABASE_URL` contains `127.0.0.1` (protecting the
  owner's Neon). The workflow passed `localhost:5432`, so all 8 guarded
  beforeAlls threw. The service container was already mapped 5432:5432 on the
  runner host; the URL host is now `127.0.0.1:5432` — CI satisfies the guard,
  the guard is unchanged.
- **Fix 2 — typecheck step moved after Build:** on a fresh checkout the
  gitignored generated files (`src/routeTree.gen.ts`, `dist/`) don't exist, so
  tsc reported hundreds of phantom errors (missing routeTree.gen collapses
  TanStack route types to any). The build regenerates both (verified: renamed
  routeTree.gen.ts away, build recreated it), so tsc after the build sees the
  same 15 baseline errors a developer machine sees.
- Typecheck is a diff guard: `site/tsc-baseline.txt` lists the 15 known
  pre-existing tsc errors (exact sorted `file(line,col): error TSxxxx: message`
  lines); the step fails only on an error NOT in the baseline (`comm -23`),
  so the 15 out-of-scope nits stay unfixed without hiding new breakage.
  Baseline may only shrink. Local verification: current tsc output diffed
  against baseline → 0 new errors (15 total = 15 baseline).
- **Result: run 34426718470 on commit 0fd382b — success (green).**
  https://github.com/cowboytroy0319-maker/Ranch-Manager-/actions/runs/34426718470
  (Test step on the prior commit e8cdf67: 230 pass / 0 fail across 12 files;
  the typecheck fix is workflow-only.)
### Screenshots (390px, real browser, seeded local `ranch` DB, scratch port 3013)
All eight captured — the five B2 shots plus the three C2 shots below, each a
real 390×844 browser capture of the built branch served on port 3013 against
the seeded local Postgres (127.0.0.1:5433) — real rendered records, no mockups:
- `qa/screenshots/pasture-cards.png` (C2) — pasture board card layout at phone
  width: Back Forty / Bull Lot / Calf Nursery cards with acres, group,
  condition, water, 21-day grazed/rest tallies, notes, full-width
  "View / manage" — no horizontal swipe anywhere.
- `qa/screenshots/activity-edit.png` (C2) — "Edit activity — North River
  Pasture" form in edit mode (Fencing, $45.50, notes, "Record as expense"
  checked) with the rule spelled out: "Changes save absolutely; the linked
  expense follows (no separate expense editing)" — plus the
  "Activity recorded and a Land / pasture expense was linked." flash.
- `qa/screenshots/linked-expense-row.png` (C2) — Expenses list with the linked
  row "Land / pasture $45.50 — North River Pasture — ↳ pasture activity —
  Created from a pasture activity — corrected there, not here. Open in
  Pasture →" and NO Delete/Edit buttons, beside manual rows that keep
  Edit/Delete.
### Revised owner phone test (≤8 steps)
1. **Expenses → ＋ Add expense**: enter a vendor, amount, category, save → the
   row shows in the ledger with Delete available (manual row).
2. **Pastures → tap a pasture → 📋 Record activity**: enter cost 45.50, keep
   "Record as expense" checked, save → flash "Activity recorded and a Land /
   pasture expense was linked." — the timeline row appears.
3. **Expenses**: find the new row — it shows "↳ pasture activity" with an
   "Open in Pasture" link and **no Delete button** (linked rows are corrected at
   the source). Manual rows from step 1 still have Delete.
4. **Back on the pasture detail → ✏️ Edit** on the activity: clear the cost,
   save → flash "…its linked expense was removed." → the Expenses row from
   step 3 is gone.
5. **Edit again**: re-enter the cost, save → the linked expense reappears in
   Expenses with the updated amount (edit created it — no separate expense
   editing needed).
6. **Double-tap safety**: tap 📋 Record activity twice quickly on the same form
   → only one activity is recorded; the duplicate attempt flashes
   "Already recorded — activity and expense unchanged."
7. **🗑 Delete** on the activity → confirmation says activity + linked expense
   go together → confirm → both disappear from the timeline and Expenses.
8. **Pastures list at phone width**: each paddock is a card (acres, group,
   condition, water, 21-day tallies) with "View / manage" — no sideways swipe
   needed anywhere.
