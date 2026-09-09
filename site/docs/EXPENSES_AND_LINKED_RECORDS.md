# Expenses & Linked Records

How the expense ledger works, how "linked" expenses are created from other
records (hay/feed restocks, pasture activities), and the rules that keep the
ledger consistent. This documents what is built today — nothing here is
aspirational.

## The expenses module

- Every expense belongs to one **operation** (ranch). All reads and writes are
  operation-scoped server-side.
- Each row has: date, **category** (required, one of the 12 below), **amount**
  (must be greater than zero), **Payee / description** (required — the `vendor`
  column; it is "who or what the money went to"), optional **paid by**, and the
  cost-allocation dimensions (herd group, pasture, equipment asset, job, notes).
- The list view filters by date range (from/to) and category. The cost
  allocation breakdown (per category / herd / pasture / equipment / job) always
  respects the active filters.
- Existing expenses can be edited or deleted from the list (with a delete
  confirmation).

## The 12 expense categories

`hay_feed` · `livestock` · `fuel` · `repairs_maintenance` · `veterinary` ·
`supplies` · `labor` · `utilities` · `land_pasture` · `insurance` ·
`taxes_fees` · `other`

Friendly labels: "Hay & feed", "Livestock", "Fuel", "Repairs & maintenance",
"Veterinary", "Supplies", "Labor", "Utilities", "Land / pasture", "Insurance",
"Taxes / fees", "Other".

### Old → new mapping (migration 0018)

Databases created before migration 0018 stored six categories. Existing rows
were remapped in place by the migration (values updated **before** the new
CHECK constraint was added, so no data was lost or orphaned):

| Old value      | New value             |
| -------------- | --------------------- |
| `feed`         | `hay_feed`            |
| `vet_health`   | `veterinary`          |
| `maintenance`  | `repairs_maintenance` |
| `fuel`         | `fuel` (unchanged)    |
| `insurance`    | `insurance` (unchanged) |
| `other`        | `other` (unchanged)   |

The six new categories (`livestock`, `supplies`, `labor`, `utilities`,
`land_pasture`, `taxes_fees`) had no old equivalent.

## Linked expenses (the linked-source model)

Some expenses are **created by the app itself** from an operational record, so
the money view and the work view can never drift apart:

| Source record                         | Expense category | `source_type`       |
| ------------------------------------- | ---------------- | ------------------- |
| Hay/feed restock with a total cost    | `hay_feed`       | `restock`           |
| Pasture activity with a cost ("Record as expense" checked) | `land_pasture` | `pasture_activity` |

- A linked expense carries `source_type` + `source_id` pointing at its source
  row. The expenses list shows these with a source indicator
  ("↳ hay restock" / "↳ pasture activity") instead of "manual".
- **Exactly once:** a unique partial index
  (`expenses_source_once_uniq` on `(source_type, source_id)` where both are
  non-null) makes it impossible for one source record to fund two ledger rows,
  even under a race. Linked-expense inserts run inside the same transaction as
  the source write, so the expense exists if and only if the source does.
- **Deleting a linked expense is blocked** with: *"This expense came from a
  hay/feed restock or pasture activity — undo that record to remove it."*
  Reversing the source record (restock delete) removes the linked expense
  atomically. This prevents orphaned accounting entries.
- **Editing a linked expense from the expenses list is also blocked** — edit
  the source record instead (the restock edit updates its linked expense, and
  blanking the cost on a restock edit removes the linked expense).

## Idempotency (no duplicate charges from retries or double-taps)

- Restocks are submitted with a `client_request_id` (a UUID generated **once
  per form-open**, kept across retries so a double-submit or a retry after a
  flaky connection cannot apply twice).
- Inside the restock transaction, the server first looks up
  `restock_log WHERE client_request_id = $ AND operation_id = $`. If found it
  returns the original result flagged `duplicate: true` **without** re-applying
  inventory or creating another expense.
- The column is `UNIQUE` in the database, so even two simultaneous requests
  cannot both insert.
- Manual expenses do not use idempotency keys (they are simple single-row
  inserts guarded by the form's disabled-while-saving state).

## Delete rules at a glance

| Row                                   | Can delete from Expenses? | What happens |
| ------------------------------------- | ------------------------- | ------------ |
| Manual expense                        | Yes (after confirmation)  | Row removed. |
| Linked expense (restock)              | **Blocked**               | Message tells you to undo the restock; deleting the restock reverses inventory and removes the linked expense in one transaction. |
| Linked expense (pasture activity)     | **Blocked**               | Same pattern for pasture activities. |

## Related docs

- `docs/PASTURE_OPERATIONS.md` — the pasture-activity side of linked expenses.
- `qa/QA_REPORT.md` — what was tested, including the exactly-once and
  inventory-safety behaviors.
