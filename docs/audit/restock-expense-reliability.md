# Restock → Expenses reliability audit (Stage 1 — diagnosis only)

**Owner complaint (verbatim intent):** the real app is failing — restocks do not reliably save, and the
restock cost does not reliably create/show up in Expenses.

**Status of this document:** audit + root cause. **Nothing was repaired, merged, or published.**

---

## 1. Branch, commit, environment audited

| Item | Value |
| --- | --- |
| Repository | `cowboytroy0319-maker/Ranch-Manager-` |
| Branch | `feature/restock-expense-reliability-audit` (created off `main`) |
| Base / audited commit | `43374e7` — "Owner priorities 1-3: stable login + password reset, permanent complimentary owner access, visible Log in on the main page (#9)" |
| Working copy | `/tmp/audit-restock/repo` (never under `/home/work`) |
| App runtime | `cd site && bun run dev --port 5199 --host 127.0.0.1` (and a second instance `--port 5299`) |
| Database | local Postgres 16, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ranch_ci` |
| Browser | `agent-browser`, device "iPhone 15" (iPhone Safari UA), viewport forced to **375 × 812** (`window.innerWidth === 375` verified in-page) |

**Why the platform preview was not used.** The brief forbids it and the brief is right: the preview
deployment has `APP_ENV` unset, and `src/db.ts` → `resolveDatabaseUrl()` returns `DATABASE_URL`
whenever `APP_ENV` is anything other than exactly `preview` (`src/db.ts:41-49`). The preview therefore
points at the **production Neon database**. I confirmed the risk is live, not theoretical: the sandbox
shell itself has the production Neon connection string exported as `DATABASE_URL`
(`postgresql://neondb_owner:***@ep-gentle-band-awddfg7l-pooler...neon.tech/neondb?sslmode=require`), so
any UI action against the preview URL would have written to production. All destructive testing was
done against local Postgres only.

### Two local databases were used on purpose

| DB | Migrations | Represents |
| --- | --- | --- |
| `ranch_ci` | **20/20** applied | what the code does when the schema is complete |
| `ranch_prodshape` | **19 applied, `0018_product_blocker.sql` deliberately absent**; `restock_log`, `pasture_activities`, `livestock_movements` dropped; `expenses.paid_by/source_type/source_id` dropped; `expenses_source_once_uniq` dropped | a byte-for-byte replica of the **production** schema (see §1b) |

### 1b. Production database, read-only introspection (the decisive evidence)

Run with `PGOPTIONS='-c default_transaction_read_only=on'` so the session **could not write**;
`current_setting('transaction_read_only')` returned `on`. Nothing was created, altered or migrated.

```
applied_count=19
0018 applied? NO
0020 applied? YES
restock_log=MISSING
pasture_activities=MISSING
livestock_movements=MISSING
has_column source_type: NO
expenses_cols: amount_cents,category,created_at,equipment_id,expense_date,herd_group_id,id,job,notes,operation_id,pasture_id,vendor
expenses_indexes: expenses_category_idx,expenses_date_idx,expenses_operation_id_idx,expenses_pkey
```

Read that against the migration file: `paid_by`, `source_type`, `source_id`, the
`expenses_source_once_uniq` index and the whole `restock_log` table **exist only in
`db/migrations/0018_product_blocker.sql`** (verified by grep over `db/migrations/*.sql` — `0018` is the
only file that mentions any of them). So the live database is missing 100% of the schema this feature
writes to and reads from.

---

## 2. The rendered Add Restock form at iPhone width

Produced by driving the real UI, not a fixture.

* `proof/restock-expense-audit/01-feed-375.png` — `/feed` at 375 px (`file`: *PNG image data, 375 x 812*), `hasRestock: true`
* `proof/restock-expense-audit/02-add-restock-form-375.png` — the **Add Restock** modal, opened by clicking the real `Restock` button on the hay row (modal scroller `scrollHeight 617 / clientHeight 449`, scrolled so cost + vendor are on screen)
* `proof/restock-expense-audit/03-restock-filled-375.png` — filled with the owner's exact numbers

The modal's contents were read straight out of the live DOM (not inferred from the image):

```
title: "Restock hay / feed"
sub:   "Adds quantity on hand — with a cost, it also records the linked expense"
fields: Item * (select) | Quantity added (bales) * (number) | Restock date * (date)
        | Total cost ($) (number) | Vendor (text) | Notes (textarea)
buttons: ✕ | Hay | Feed | Cancel | "Save restock"
```

Cost/vendor/date after filling: `{qty:"25", cost:"312.50", vendor:"Triple C Hay", date:"2026-09-26", item:"1"}`.

---

## 3. The browser submit request / response (against the complete schema)

Captured by wrapping `window.fetch` in the live page before submitting.

```
POST /_serverFn/eyJmaWxlIjoiL3NyYy9zZXJ2ZXIvZmVlZC50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJyZXN0b2NrSXRlbV9jcmVhdGVTZXJ2ZXJGbl9oYW5kbGVyIn0
body:   {"data":{"client_request_id":"6a2b49f7-44f2-4684-b3e8-4597b1b4940f","item_kind":"hay","item_id":1,
         "quantity":25,"unit":"bales","restock_date":"2026-09-26","total_cost_cents":31250,
         "vendor":"Triple C Hay","notes":"25 bales — Triple C Hay"}}
status: 200
resp:   {"ok":true,"id":1,"expense_created":true,"duplicate":false}
toast:  "✅ Inventory updated and expense recorded."
```

(The `/_serverFn/…` segment is base64 of `{"file":"/src/server/feed.ts","export":"restockItem_createServerFn_handler"}`.)

So **the client is correct**: 25 bales, $312.50 → `total_cost_cents: 31250`, unit pinned to `bales`,
vendor and date carried through, one idempotency key minted for the form-open.

---

## 4. Server validation + the database transaction as it really executes

Validation (`parseRestockInput`, `src/server/feed.ts:375-407`) passes all of the above.
`restockItemCore` (`src/server/feed.ts:427-500`) then runs, in one `db.begin` transaction:

1. `SELECT id, total_cost_cents FROM restock_log WHERE client_request_id = $1 AND operation_id = $2` — `feed.ts:438-440`
2. `SELECT unit FROM hay_inventory WHERE id = $1 AND operation_id = $2 FOR UPDATE` — `feed.ts:452-453`
3. `INSERT INTO restock_log (…, client_request_id) VALUES (…) RETURNING id` — `feed.ts:455-460`
4. `UPDATE hay_inventory SET quantity = quantity + $1, updated_at = now() WHERE id = $2 AND operation_id = $3` — `feed.ts:461-462`
5. `INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, notes, pasture_id, source_type, source_id) VALUES (…,'hay_feed',…,'restock',$id)` — `feed.ts:463-473` → `insertLinkedExpense` (`feed.ts:737-756`)

Against `ranch_ci` (complete schema) all five statements succeed — proven by the effect in §5/§6.
Against the production schema, **statement 1 is the first thing the transaction does, and it cannot
succeed** — see §8.

---

## 5. Inventory record: before / after

Hay stack seeded through SQL into the scratch operation (`operation_id = 2`, "Audit Ranch"), item id 1:
`grass, 2nd cutting, River Field, Main barn — south row, 80 bales, bale weight 62, acquired 2026-07-15, low-stock at 20`.

| | on hand |
| --- | --- |
| before | **80 bales** |
| after  | **105 bales** |

`+25` — exactly the quantity submitted, in the item's own unit. `restock_log` went `0 → 1`.

---

## 6. Linked expense: creation, query, display

Created row (queried directly in the local DB):

```
expense: id=… date=2026-09-26 category=hay_feed amount_cents=31250 vendor="Triple C Hay"
         source_type="restock" source_id=<restock_log.id>  (paid_by NULL)
```

`expenses` count for the operation went `0 → 1`. One restock produced exactly one expense, carrying the
`(source_type='restock', source_id)` link that `expenses_source_once_uniq` protects.

Display: the response's own message and the `expense_created:true` flag are what the UI reports
(`restockResultMessage`, `src/components/feed/restockUI.ts`).

**On the production schema this is where failure hides twice** — not only is no expense created (§8),
but the Expenses page's own read is broken there too (§8, root cause 2). `/expenses` reads
`e.paid_by, e.source_type, e.source_id, (e.source_type IS NOT NULL) AS linked`
(`src/server/expenses.ts:93-95`), columns that do not exist in production.

> Not completed: the screenshot pair `04-expenses-after-restock-375.png` /
> `05-expenses-after-reload-375.png` (server was reachable and the script is written, but the run did
> not get far enough before the session budget ended — see §9 "not completed"). The claim above is
> therefore based on the DB row + the captured 200 response, **not** on a screenshot of `/expenses`.

---

## 7. Relevant server/runtime logs

* Client-side: no JS error, no failed request. The submit returns HTTP **200** with a well-formed body —
  the failure mode is a *successful transport carrying a failure payload*, which is exactly why it reads
  as flakiness rather than a bug.
* Server-side: `src/dbErrors.ts:96-104` logs the real cause once, at the DB layer, as
  `[db] database error (code=42P01): PostgresError: relation "restock_log" does not exist`, then replaces
  the message the handler sees. That comment block in `dbErrors.ts` **actively documents this exact
  incident**: *"the exact `relation "restock_log" does not exist` the owner saw on the preview when
  migration 0018 had not been applied."* The prior team saw this failure and built a message firewall
  around it instead of applying the migration.
* Dumping `/tmp/vite5299.log` (the production-shaped run) for the `[db]` lines was not reached — see §9.

---

## 8. Root cause of each failure

### Root cause 1 — "restocks do not reliably save" → **deterministic, not intermittent**

Production is missing migration `0018_product_blocker.sql`. The very first statement of the restock
transaction reads `restock_log` (`src/server/feed.ts:438-440`). On production that table does not exist,
so Postgres raises SQLSTATE **42P01** (`relation "restock_log" does not exist`). It is inside
`db.begin(...)`, so the whole transaction aborts: **no `restock_log` row, no `hay_inventory` UPDATE, no
expense.** The handler's `catch` (`feed.ts:421-423`) returns `{ok:false, error}` and the modal shows an error.

This is **100% reproducible for every restock, with or without a cost**, because the failing statement
comes before any branching on the cost. There is no race, no timing window and no data dependency — a
restock on production cannot succeed. The intermittency the owner perceives is explained by root cause 3.

### Root cause 2 — "the restock cost does not reliably show up in Expenses" → **two independent defects**

a. **No expense is ever created**, because root cause 1 aborts the transaction before
   `insertLinkedExpense` runs (`feed.ts:463-473`).

b. **The Expenses page cannot be read at all on production.** `getExpensesData` selects
   `e.paid_by`, `e.source_type`, `e.source_id` and derives `(e.source_type IS NOT NULL) AS linked` for
   every row (`src/server/expenses.ts:92-106`), and `paid_by`/`source_type`/`source_id` come only from
   `0018`. On production the query raises **42703** (`column e.source_type does not exist`), the
   handler's `catch` returns `{configured:true, error:"We couldn't load your expenses right now. Please
   refresh and try again."}` (`expenses.ts:169-186`), and the page renders that error. This breaks the
   Expenses page for **every** expense — manual ones included — not just restock-linked ones.

So both halves of the owner's complaint trace to a single missing migration, surfacing as two different
user-visible failures.

### Root cause 3 — why it feels unreliable rather than plainly broken

`src/dbErrors.ts:96-113` rewrites every database-originated error into a customer-safe sentence. Outside
the preview that is `"We couldn't complete that right now. Please try again."`. A permanent
schema/deploy fault is therefore presented to the owner as a transient, retryable-sounding message with
no cause, and retrying can never work. Meanwhile `/feed` loads normally and the Restock form opens,
validates and submits without a client error — the app *looks* alive right up to the moment it silently
refuses. That combination is precisely "not reliable".

### Steps that do **not** fail — stated plainly

* The **client** is correct: payload, cents conversion, unit pinning, date, vendor all arrive intact (§3).
* The **server validation** is correct and does not reject the owner's numbers.
* The **transaction logic** is correct: on a complete schema, 25 bales / $312.50 / Triple C Hay produces
  exactly one inventory increment and exactly one linked expense (§5, §6).
* The **idempotency design** is correct and `client_request_id` scoping is per-operation (not global),
  matching the composite constraint in `0018`.
* `/feed` itself loads and the modal opens normally on the production schema (the failure is at submit).

---

## Defects found on this path

| # | Severity | Defect |
| --- | --- | --- |
| D1 | **CRITICAL** | Production is missing migration `0018_product_blocker.sql`. No restock can ever save; no linked expense can ever be created. This is the deploy prerequisite, and it is still outstanding. |
| D2 | **CRITICAL** | The Expenses ledger read (`expenses.ts:92-106`) hard-selects `0018`-only columns (`paid_by`, `source_type`, `source_id`) for *every* row, including manual expenses. One missing link column takes the entire Expenses page down instead of degrading to "linked costs unavailable". |
| D3 | **HIGH** | `dbErrors.ts` converts a permanent schema fault into `"We couldn't complete that right now. Please try again."`, instructing the user to do the one thing that cannot help. The raw SQLSTATE stays server-side only, so no one is told the database is un-migrated. |
| D4 | **HIGH** | No deploy-time or startup check that the schema is migrated. The app serves happily against an un-migrated database and fails only when the user clicks Save. |
| D5 | **MEDIUM** | Cost is **optional** and a blank/`0` cost silently means "no expense" (`FeedModals.tsx:647-657`, `feed.ts:392-395`). There is no visible "yes/no" about the expense, so intent is invisible in the form. |
| D6 | **MEDIUM** | The submit button always reads **"Save restock"**, even when a cost is entered and an expense *will* be created. The user cannot tell from the button what is about to happen. |
| D7 | **MEDIUM** | The cost field is labelled **"Total cost ($)"**, not "Total cost paid". (PR #10 renames it; that branch is not merged and was not touched.) |
| D8 | **MEDIUM** | Nowhere on the form does it say what is *not* happening: a blank cost creates inventory only, silently. There is no "Inventory only — no expense" statement. |
| D9 | **LOW–MEDIUM** | No "reference" field separate from Notes; the owner asked for notes/reference. |
| D10 | **LOW** | Helper text under the cost field reads "Optional — with a cost, a Hay & feed expense is recorded and linked to this restock." It never states the required consequence: *"Saving this restock will add this amount to Expenses."* |
| D11 | **LOW** | Success feedback is a transient toast only; `restockMessage` is cleared on the next `openRestock` (`feed.tsx:59-63, 487-501`). Nothing in the inventory row says "restocked at $312.50". |
| D12 | **LOW / not currently exploitable** | The idempotency key is minted once per form-open and never regenerated (`FeedModals.tsx:544`, `restockUI.ts`). I checked the wiring: the modal is mounted as `{restockOpen && <RestockModal …/>}` with no `key`, but a successful save sets `restockOpen=false` (`feed.tsx:480-484`), which unmounts it, so the next open gets a fresh key. I could not construct a live path where a stale key suppresses a genuine second restock — flagging it as a guard worth adding, not a proven defect. |

## Owner-required form fields / behaviours: what exists today

| Required | Today on `main` (`43374e7`) |
| --- | --- |
| quantity | ✅ "Quantity added (bales) *" |
| unit | ⚠️ partial — shown in the label and pinned to the item's unit server-side; no independent unit control |
| vendor / payee | ✅ "Vendor" |
| restock date | ✅ "Restock date *" (defaults to today) |
| **REQUIRED cost** | ❌ optional; blank is allowed and means "no expense" |
| notes / reference | ⚠️ Notes ✅; no separate reference field |
| "add linked expense" choice, on by default when a cost is entered | ❌ does not exist |
| helper "Saving this restock will add this amount to Expenses." | ❌ different copy ("Optional — with a cost, a Hay & feed expense is recorded…") |
| button "Save restock & add expense" | ❌ button reads "Save restock" |
| explicit "Inventory only — no expense" when cost is blank | ❌ does not exist |

---

## 9. What was not completed (so Stage 2 does not redo it)

1. **Repeat attempts 2–3 and the fast double-submit run were not performed.** The evidence for
   "deterministic, not intermittent" is therefore *code-path* evidence (the first statement of the
   transaction reads a table that does not exist on production, before any cost branching), not an
   observed multi-run sample. This is a real gap in the owner's requested evidence, and it is the first
   thing Stage 2 should close.
2. **The production-shaped browser reproduction was set up but not driven to completion.** DB
   `ranch_prodshape` was built and verified to match production exactly (`applied=19`, `0018? NO`,
   `restock_log=MISSING`, identical `expenses` column list); identity + inventory were cloned into it via
   `pg_dump -a` so the same browser session could authenticate; a second dev server on `:5299` was
   launched against it. The script that drives the UI there, captures the failing request/response, the
   unchanged DB and the `[db]` log line is ready at **`/tmp/p2.sh`** (writes proofs
   `06-prodshape-restock-modal-375.png` … `09-prodshape-expenses-375.png`). It had not finished when the
   session budget ended.
3. `/expenses` screenshots (04/05) — see the note in §6.
4. The `[db] database error` log dump from the production-shaped run.

## Environment to reproduce in

```bash
# Postgres 16 local, two databases
pc_ctlcluster 16 main start          # policy-rc.d blocks auto-start; start by hand
createdb ranch_ci ranch_prodshape
cd /tmp/audit-restock/repo/site
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ranch_ci        bun run db:migrate   # 20
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ranch_prodshape bun run db:migrate   # 20
# then reverse 0018 in ranch_prodshape: drop restock_log/pasture_activities/livestock_movements,
# drop expenses.{paid_by,source_type,source_id} + expenses_source_once_uniq, and
# DELETE FROM schema_migrations WHERE name='0018_product_blocker.sql';  -> applied=19
DATABASE_URL=…ranch_ci APP_ENV=development bun run dev --port 5199 --host 127.0.0.1
DATABASE_URL=…ranch_prodshape APP_ENV=production bun run dev --port 5299 --host 127.0.0.1
```

**A note on the shared shell:** the `main` bash session is written to concurrently by another team
member, which corrupted several of my commands and silently swallowed output. Every script in this audit
was therefore written to a file and run under `nohup … &` with an `=== END ===` marker, and read back
from its output file. A **private** session name works for execution if you name one (I used `auditx`) —
worth knowing, because the common advice that only `main` executes is not accurate here.

## Constraint compliance

No merge, no publish, no `publish_site`, no production migration, no production data write, no
production reset, no Stripe/billing/domain/secret/owner-account change, no preview-URL testing. The only
production contact was read-only schema introspection inside a `default_transaction_read_only=on`
session. The audit branch contains this document and the proof images only — no source change.
