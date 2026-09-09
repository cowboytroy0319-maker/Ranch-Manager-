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
2. The pasture board is a wide table inside a horizontal-scroll container at
   phone widths (usable with a swipe; no page-level overflow). A card layout
   for phones is future work.
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
