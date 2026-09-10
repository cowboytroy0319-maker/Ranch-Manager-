# Pasture Operations

What the pasture module records today, how livestock movement is modeled, and
its honest limitations. Nothing here is aspirational.

## Pasture records

A pasture (paddock/grazing unit) has:

- **Name** (required).
- **Size in acres** — optional; must be greater than zero when present
  (nullable as of migration 0018).
- **Pasture type / use** — free text, optional.
- **Capacity (head count)** — optional integer ≥ 0.
- **Water status** — one of `good`, `needs_attention`, `unavailable`,
  `unknown` (defaults to `unknown`).
- **Condition** — one of `excellent`, `good`, `fair`, `poor`, `resting`
  (defaults to `good`).
- **Location, soil type, notes** — free text.
- **Status** — `grazing`, `resting`, `idle`, or `maintenance` (from the
  grazing board).

The **pasture detail view** (tap a pasture row) shows the current group(s)
assigned, status/condition/water/acres/capacity, turnout date (the active
assignment's start date), days in pasture, the activity timeline, and the
movement history. Mobile actions: **Record activity**, **Update condition**,
**Update water**, **Move group**.

## Activities

Pasture work is recorded as an **activity**: date, type, optional cost, notes.

Activity types (10): `fencing`, `water_system`, `mowing`, `fertilizing`,
`spraying`, `reseeding`, `mineral_salt`, `repair`, `inspection`, `other`.

If a cost is entered and **"Record as expense"** is checked (the default), the
app creates one linked expense (category `land_pasture`, `source_type =
'pasture_activity'`) in the same transaction. See
`docs/EXPENSES_AND_LINKED_RECORDS.md` for the linked-expense rules: the
expense cannot be deleted or edited from the expenses list — it is owned by
the activity, and it is removed if the activity's cost/expense flag is
changed. (Activity deletion is not exposed in this release.)

## The movement model: GROUP-based (important)

Movement is tracked **per herd group, not per animal**:

- The app's operational model is `pasture_assignments`: one row per
  (herd_group → pasture) with an `assigned_at` date; the current assignment is
  the one with `ended_at IS NULL`.
- **Move group** closes the group's active assignment (`ended_at = move
  date`), opens the new assignment, and writes a `livestock_movements` history
  row (from → to pasture, date, group, optional head count, notes).
- Rules enforced server-side: no self-move ("already in that pasture"),
  group/destination must belong to your operation, head count cannot be
  negative. The whole move is one transaction.

**Limitation to be aware of:** individual animals carry a **free-text
`pasture` field, not a foreign key** to the pasture table. That text is not
updated by a group move. So the per-animal "pasture" label on the livestock
side is informational only; the authoritative grazing state is the group
assignment. If you move animals between groups without recording it, the
group-level picture can drift from your pens — the app does not (yet) track
per-animal movement.

## What the module does NOT do (honest limitations)

- **No forage science.** No carrying-capacity predictions, no forage
  quantity/quality estimates, no grazing-wear modeling, no region-aware
  stocking-rate recommendations. The grazing board's "days grazed / days
  rested" figures are simple date arithmetic on assignment history, not
  forage-budget calculations.
- **No per-animal tracking** (see above) — movement is group-level only.
- **No rainfall/growth model** behind rest periods; rest days are recorded
  history, not agronomic advice.

The demo site's separate "regional intelligence" sample view is explicitly
labeled demo content; it is not wired into this operational module.

## Related docs

- `docs/EXPENSES_AND_LINKED_RECORDS.md` — linked expenses from activities.
- `qa/QA_REPORT.md` — tested behaviors and the owner phone test.
