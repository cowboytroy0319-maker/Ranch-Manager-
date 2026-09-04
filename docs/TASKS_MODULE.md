# Ranch Tasks & Projects Module

The **Tasks & Projects** module turns the daily to-do list into a scoped, persistent
record — and feeds the Daily Operations dashboard's **"Today's tasks"** card. It is a
real-data module backed by Postgres (migration `0015_tasks_projects.sql`), protected by
the same auth (`beforeLoad` + `getSession`) and operation-isolation rules as every other
module.

## Schema (`db/migrations/0015_tasks_projects.sql`)

Two tables, both scoped by `operation_id` (FK → `operations(id)` ON DELETE CASCADE) so
no account ever sees another ranch's work.

**`projects`** — simple named grouping of related work.
| column | type / note |
|---|---|
| `id` | identity PK |
| `operation_id` | ranch scope (NOT NULL, FK cascade) |
| `name` | text NOT NULL (max 200 in the validator) |
| `description` | text, nullable |
| `created_at` | timestamptz default now() |

**`tasks`** — the daily record.
| column | type / note |
|---|---|
| `id` | identity PK |
| `operation_id` | ranch scope (NOT NULL, FK cascade) |
| `title` | text NOT NULL (max 300 in the validator) |
| `description` | text, nullable |
| `status` | CHECK: `to_do` / `in_progress` / `completed` / `canceled` |
| `priority` | CHECK: `low` / `normal` / `high` / `urgent` |
| `due_date` | date, nullable |
| `category` | CHECK: livestock / feed-hay / pasture / fencing-water / equipment / crops-farm / paperwork / general |
| `project_id` | FK → projects(id) ON DELETE SET NULL |
| `pasture_id` | FK → pastures(id) ON DELETE SET NULL |
| `equipment_id` | FK → equipment(id) ON DELETE SET NULL |
| `animal_id` | FK → animals(id) ON DELETE SET NULL |
| `created_at` / `updated_at` | timestamptz default now() |

Optional link columns let a task attach to an existing pasture / piece of equipment /
animal — but the link targets must belong to the **same operation** (scope guard in
`saveTask` / `updateTask`), so a task can never reference another ranch's record.

## Server functions (`src/server/tasks.ts`)

- `getTasksData` — one round-trip read: tasks (with joined names), projects, and the
  option lists (pastures / equipment / animals) for the form selects. All scoped by
  `requireAuth().operationId`.
- `saveTask` — insert or update (title/description/status/priority/due/category + links).
- `updateTask` — update path used by full edits; also re-scopes the link columns.
- `completeTask` / `reopenTask` — one-tap `to_do` ↔ `completed`.
- `saveProject` — create/update a project.
- `getDashboardTasks` — the Daily Ops card data: open tasks (to_do / in_progress) that
  are **overdue**, **due today**, or **urgent/high priority**, most urgent first.
- Pure, DB-free helpers (unit-tested): `parseTaskInput`, `parseProjectInput`, `dueBucket`,
  `selectDashboardTasks`, `dashboardCounts`, `todayStr`.

Every write guards its `UPDATE ... WHERE id=… AND operation_id=…`; a cross-ranch write
matches zero rows and is rejected ("no longer exists in this ranch").

## UI / routes

- **`/tasks`** (`src/routes/tasks.tsx`) — the module page:
  - **Quick-add card** (title, due date, priority, category) with an expandable
    "Add details" panel for description / status / project / pasture / equipment / animal links.
  - **Filters** — status, priority, due (overdue / today / upcoming / none), category, project.
  - **Task list** — open tasks first (soonest due), one-tap **complete/reopen** circle,
    inline **Edit** (opens a modal reusing the same form), and an **empty state** that
    explains how to add the first task.
  - **Projects panel** — small "new project" input + list showing task counts.
  - Mobile-first: stacked cards and large tap targets; links to pastures/equipment/animals
    render as chips.
- **Dashboard** (`/dashboard` → `TasksSnapshot.tsx`) — a "Today's tasks" card just below
  the Morning Briefing, linking each row to `/tasks`.
- **AppShell nav** — the `/tasks` link (✅) is already in `APP_NAV`.

## Scoping / flows (how isolation works)

1. Route `beforeLoad` calls `getSession()`; a sessionless visitor is redirected to `/login`.
2. Every server fn calls `requireAuth()` → resolves the session `operation_id`.
3. Reads filter every `WHERE … operation_id = ${operationId}`; writes scope their
   `UPDATE/INSERT` the same way, and the link-column scope guard rejects cross-ranch refs.
4. `src/server/tasks.test.ts` verifies this end-to-end against a local Postgres: Ranch A
   cannot read / edit / complete / reopen / delete Ranch B's tasks, hay, pasture, or equipment.

## Tests

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
  bun test src/server/tasks.test.ts
```

26 tests: validator rules, pure dashboard selection (`selectDashboardTasks` / `dueBucket` /
`dashboardCounts`), task lifecycle (create / update / complete / reopen) persisted to the
local DB, operation isolation across tasks + hay + pasture + equipment, and persisted
writes for the `saveHay` / `savePasture` / `saveEquipment` shapes. The file refuses to run
against anything that isn't a local Postgres (127.0.0.1), so Neon is never touched.

> **Note:** migration `0015` is intentionally **not** applied to Neon in this work — until
> the lead applies it, `/tasks` and the dashboard "Today's tasks" card show the designed
> "Database error" state (schema not present), and no publish was run.
