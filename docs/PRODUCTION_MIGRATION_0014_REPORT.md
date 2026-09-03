# Production Migration 0014 — Verification Report

**Status:** ✅ COMPLETE — verified on the live Ranch Manager Pro Neon production database.

- **Database verified as production:** **yes** — host resolves to a Neon endpoint; all production marker tables present (`subscription_events`, `page_views`, `subscribers`, `app_settings`, `schema_migrations`, `expenses`, `equipment`, `animals`). Not local Postgres, not any test database. No connection details recorded here.

---

## Migrations applied + timestamps (from `schema_migrations`)

| Migration | Recorded as applied | Applied at (UTC) |
|---|---|---|
| `0013_animals_ranch_scope.sql` | yes (was **already applied** — verified; runner skipped it) | 2026-09-02 17:02:17 |
| `0014_auth_users_operations.sql` | yes | **2026-09-03 14:20:26** |

Both are recorded in the migration log table with timestamps. `0013` was confirmed already applied before `0014` ran, so it did **not** need re-application; the runner applied exactly one new migration (`0014`) in numerical order via the project's normal `bun run db:migrate` flow against `DATABASE_URL`.

## Pre/post row-count comparison (counts only, no row content)

| Table | Pre | Post | Δ |
|---|---:|---:|---:|
| operations | 1 | 1 | 0 |
| animals | 30 | 30 | 0 |
| herd_groups | 3 | 3 | 0 |
| hay_inventory | 5 | 5 | 0 |
| feed_inventory | 5 | 5 | 0 |
| usage_log | 63 | 63 | 0 |
| pastures | 8 | 8 | 0 |
| pasture_assignments | 6 | 6 | 0 |
| grazing_log | 168 | 168 | 0 |
| pasture_observations | 6 | 6 | 0 |
| equipment | 12 | 12 | 0 |
| maintenance_records | 13 | 13 | 0 |
| fuel_log | 83 | 83 | 0 |
| expenses | 12 | 12 | 0 |
| employees | 4 | 4 | 0 |
| tax_exemptions | 0 | 0 | 0 |
| subscription_events | 7 | 7 | 0 |

**Result:** All 17 tables preserved; **no existing operational data lost** — every pre-existing row count is unchanged. Adding the `operation_id` columns inserted no rows.

## Default Operation backfill

- `operations` contains exactly **one** row: `1` = "Default Operation" (id = `1`).
- After 0014, **every scoped table has zero NULL `operation_id` rows** and **100% of rows are assigned to operation `1`** (the seeded Default Operation — the `SELECT id FROM operations ORDER BY id LIMIT 1` target):
  - herd_groups {1:3}, hay_inventory {1:5}, feed_inventory {1:5}, usage_log {1:63}, pastures {1:8}, pasture_assignments {1:6}, grazing_log {1:168}, pasture_observations {1:6}, equipment {1:12}, maintenance_records {1:13}, fuel_log {1:83}, expenses {1:12}, employees {1:4}, subscription_events {1:7}, tax_exemptions (0 rows — no NULLs), each with **0 NULLs**.
- animals backfill (0013) likewise: 30/30 on ranch_id `1`, `ranch_id` NOT NULL.

## New tables, FKs, indexes (0014)

- **`users`**: exists — `id` (identity PK), `email` (text NOT NULL UNIQUE), `password_hash` (text NOT NULL), `created_at` (timestamptz NOT NULL). **0 rows** (no test/customer records created).
- **`operation_memberships`**: exists — `id` PK, `user_id` FK→`users(id)` ON DELETE CASCADE, `operation_id` FK→`operations(id)` ON DELETE CASCADE, `role` NOT NULL DEFAULT 'owner' with `CHECK (role IN ('owner','worker','viewer'))`, `created_at`; **UNIQUE(user_id, operation_id)** present (unique index `operation_memberships_user_id_operation_id_key`). **0 rows**.
- **`sessions`**: exists — `token_hash` text PK, `user_id` FK→`users(id)` ON DELETE CASCADE, `created_at`, `expires_at` (timestamptz NOT NULL); indexes `sessions_expires_at_idx` and `sessions_user_id_idx` both present (plus pkey). **0 rows**.
- Non-scoped, as specified: `operations`, `users`, `operation_memberships`, `sessions`, `animals` (ranch_id since 0013), `health_events`, `page_views`, `subscribers`, `app_settings` — untouched.

## Scoping columns + indexes on operational tables

`operation_id` column exists on all 15 scoped tables with the `<table>_operation_id_idx` index present on each; FK to `operations(id)` present on each:

- **NOT NULL** on: herd_groups, hay_inventory, feed_inventory, usage_log, pastures, pasture_assignments, grazing_log, pasture_observations, equipment, maintenance_records, fuel_log, expenses, employees, tax_exemptions.
- **Nullable (by design of 0014)** on: `subscription_events` (migration adds column + backfill + index but no SET NOT NULL) — 0 NULLs regardless.
- **`animals` (from 0013)**: `ranch_id` present, **NOT NULL**; partial unique index `animals_ranch_tag_uniq ON animals (ranch_id, tag_number) WHERE (tag_number IS NOT NULL)` present.

## Issues / warnings / rollback consideration

- **No blocking issues.** The two verified deviations from the generic checklist are both intentional and match the migration files exactly: (1) `subscription_events.operation_id` is nullable (0014 deliberately omits SET NOT NULL there), and (2) FKs on some tables number more than 1 (usage_log=4, pasture_assignments=3, grazing_log=2, pasture_observations=2, maintenance_records=2, fuel_log=2, expenses=4, employees=2) because those tables already had pre-existing FKs (e.g. pasture_id, equipment_id, animal_id) — all still valid.
- **Rollback consideration:** Reverting 0014 would require, per table: dropping the `<table>_operation_id_idx` index, dropping the `operation_id` column (FK drops with it; note `subscription_events` was never NOT NULL so its column drop is trivially safe), and dropping `sessions`, `operation_memberships`, `users` (in that order due to FKs) — after first deleting any new rows those tables may hold (there are currently none). The `schema_migrations` row for 0014 must also be removed. Because the migration is additive and backfills (no data loss/transformation), reverting is straightforward; expected operational impact of full revert: `/register` and `/login` return to the "Database error" state until 0015-equivalent is applied. No rollback was performed — nothing to roll back.
- **No secrets, connection strings, or private row content appear anywhere in this report.**

## Recommendation

**Safe to publish authentication build** — migration 0014 applied cleanly and recorded, all 17 tables preserved with identical counts, Default Operation backfill is 100% complete, new auth tables/FKs/indexes/checks verified, and zero new data was created.