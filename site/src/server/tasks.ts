// ============================================================================
// Ranch Manager Pro — Tasks & Projects server functions (the only place that
// talks to the database for this module). Import only from route files;
// handlers run on the server, are scoped by the authenticated operation, and
// return JSON-safe data. There is NO Default-Operation fallback: every read
// and write filters by auth.operationId.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type DashboardTask,
  type Task,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
  type TasksData,
} from "~/types/tasks";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getTasksData = createServerFn().handler(async (): Promise<TasksData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, tasks: [], projects: [], pastures: [], equipment: [], animals: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const [taskRows, projectRows, pastureRows, equipRows, animalRows] = await Promise.all([
      db`
        SELECT t.id, t.operation_id, t.title, t.description, t.status, t.priority,
               to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.category,
               t.project_id, t.pasture_id, t.equipment_id, t.animal_id,
               p.name AS pasture_name, e.name AS equipment_name, a.name AS animal_name,
               pr.name AS project_name,
               t.created_at::text AS created_at, t.updated_at::text AS updated_at
        FROM tasks t
        LEFT JOIN pastures p ON p.id = t.pasture_id
        LEFT JOIN equipment e ON e.id = t.equipment_id
        LEFT JOIN animals a ON a.id = t.animal_id
        LEFT JOIN projects pr ON pr.id = t.project_id
        WHERE t.operation_id = ${auth.operationId}
        ORDER BY t.due_date NULLS LAST, t.id DESC`,
      db`
        SELECT id, name, description, created_at::text AS created_at
        FROM projects
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT id, name FROM pastures
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT id, name FROM equipment
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT id, name FROM animals
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
    ]);

    return {
      configured: true,
      tasks: taskRows as unknown as Task[],
      projects: projectRows as unknown as TasksData["projects"],
      pastures: pastureRows as unknown as TasksData["pastures"],
      equipment: equipRows as unknown as TasksData["equipment"],
      animals: animalRows as unknown as TasksData["animals"],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      tasks: [],
      projects: [],
      pastures: [],
      equipment: [],
      animals: [],
    };
  }
});

// ---------------------------------------------------------------------------
// Validation helpers (plain, no schema library — mirrors livestock.ts)
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  return s;
};

export type TaskInput = {
  id?: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  category: TaskCategory;
  project_id: number | null;
  pasture_id: number | null;
  equipment_id: number | null;
  animal_id: number | null;
};

export function parseTaskInput(raw: unknown): TaskInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const title = str(d.title);
  if (!title) throw new Error("Task title is required.");
  if (title.length > 300) throw new Error("Task title is too long (max 300 characters).");
  const id = optionalInt(d.id);
  return {
    id: id === null ? undefined : id,
    title,
    description: str(d.description),
    status: oneOf(d.status, TASK_STATUSES) ?? "to_do",
    priority: oneOf(d.priority, TASK_PRIORITIES) ?? "normal",
    due_date: isoDate(d.due_date),
    category: oneOf(d.category, TASK_CATEGORIES) ?? "general",
    project_id: optionalInt(d.project_id),
    pasture_id: optionalInt(d.pasture_id),
    equipment_id: optionalInt(d.equipment_id),
    animal_id: optionalInt(d.animal_id),
  };
}

export type ProjectInput = {
  id?: number;
  name: string;
  description: string | null;
};

export function parseProjectInput(raw: unknown): ProjectInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  if (!name) throw new Error("Project name is required.");
  if (name.length > 200) throw new Error("Project name is too long (max 200 characters).");
  const id = optionalInt(d.id);
  return { id: id === null ? undefined : id, name, description: str(d.description) };
}

// ---------------------------------------------------------------------------
// Write: save/create a task (insert or update)
// ---------------------------------------------------------------------------

export const saveTask = createServerFn({ method: "POST" })
  .validator(parseTaskInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const t = data;
      if (t.id) {
        const updated = await db`
          UPDATE tasks SET title=${t.title}, description=${t.description}, status=${t.status},
            priority=${t.priority}, due_date=${t.due_date}, category=${t.category},
            project_id=${t.project_id}, pasture_id=${t.pasture_id}, equipment_id=${t.equipment_id},
            animal_id=${t.animal_id}, updated_at=now()
          WHERE id=${t.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Task #${t.id} no longer exists.` };
        return { ok: true, id: t.id };
      }
      // Insert: every column is scoped to the session operation. The optional
      // link columns (project / pasture / equipment / animal) must also belong
      // to the same operation or the row is rejected (FK + scope guard below).
      const [row] = await db<[{ id: number }]>`
        INSERT INTO tasks (operation_id, title, description, status, priority, due_date, category,
                           project_id, pasture_id, equipment_id, animal_id)
        VALUES (${auth.operationId}, ${t.title}, ${t.description}, ${t.status}, ${t.priority}, ${t.due_date},
                ${t.category}, ${t.project_id}, ${t.pasture_id}, ${t.equipment_id}, ${t.animal_id})
        RETURNING id`;
      // Scope guard for the optional link columns: a task may only reference
      // records inside this operation. (FKs already forbid a dangling id.)
      if (t.project_id || t.pasture_id || t.equipment_id || t.animal_id) {
        const valid = await db<[{ n: number }]>`
          SELECT count(*)::int AS n FROM tasks
          WHERE id = ${row.id}
            AND (${t.project_id} IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ${t.project_id} AND operation_id = ${auth.operationId}))
            AND (${t.pasture_id} IS NULL OR EXISTS (SELECT 1 FROM pastures WHERE id = ${t.pasture_id} AND operation_id = ${auth.operationId}))
            AND (${t.equipment_id} IS NULL OR EXISTS (SELECT 1 FROM equipment WHERE id = ${t.equipment_id} AND operation_id = ${auth.operationId}))
            AND (${t.animal_id} IS NULL OR EXISTS (SELECT 1 FROM animals WHERE id = ${t.animal_id} AND ranch_id = ${auth.operationId}))`;
        if (Number(valid[0].n) !== 1) {
          await db`DELETE FROM tasks WHERE id = ${row.id}`;
          return { ok: false, error: "That linked record doesn't exist in this ranch." };
        }
      }
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: update an existing task (status/priority/due/category/project/title/
// notes). Used by full edits AND the inline quick actions (mark complete /
// reopen, set status/priority) so one code path covers both.
// ---------------------------------------------------------------------------

export const updateTask = createServerFn({ method: "POST" })
  .validator(parseTaskInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    if (!data.id) return { ok: false, error: "A task id is required to update." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const t = data;
      const taskId = Number(t.id);
      // Re-scope the optional link columns so a cross-ranch reference is
      // rejected (zero-row UPDATE below would silently succeed otherwise).
      if (t.project_id || t.pasture_id || t.equipment_id || t.animal_id) {
        const okRefs = await db<[{ n: number }]>`
          SELECT count(*)::int AS n FROM tasks
          WHERE
            (${t.project_id} IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ${t.project_id} AND operation_id = ${auth.operationId}))
            AND (${t.pasture_id} IS NULL OR EXISTS (SELECT 1 FROM pastures WHERE id = ${t.pasture_id} AND operation_id = ${auth.operationId}))
            AND (${t.equipment_id} IS NULL OR EXISTS (SELECT 1 FROM equipment WHERE id = ${t.equipment_id} AND operation_id = ${auth.operationId}))
            AND (${t.animal_id} IS NULL OR EXISTS (SELECT 1 FROM animals WHERE id = ${t.animal_id} AND ranch_id = ${auth.operationId}))`;
        if (Number(okRefs[0].n) !== 1) return { ok: false, error: "That linked record doesn't exist in this ranch." };
      }
      const updated = await db`
        UPDATE tasks SET title=${t.title}, description=${t.description}, status=${t.status},
          priority=${t.priority}, due_date=${t.due_date}, category=${t.category},
          project_id=${t.project_id}, pasture_id=${t.pasture_id}, equipment_id=${t.equipment_id},
          animal_id=${t.animal_id}, updated_at=now()
        WHERE id=${taskId} AND operation_id=${auth.operationId} RETURNING id`;
      if (updated.length === 0) return { ok: false, error: `Task #${taskId} no longer exists.` };
      return { ok: true, id: taskId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: toggle an open task complete (or reopen it). Kept as its own tiny
// mutation so the list/dashboard UI has a one-tap "done / reopen" action.
// ---------------------------------------------------------------------------

export const completeTask = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const id = Number(d.id);
    if (!Number.isFinite(id) || id <= 0) throw new Error("A valid task id is required.");
    return { id };
  })
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const updated = await db`
        UPDATE tasks SET status='completed', updated_at=now()
        WHERE id=${data.id} AND operation_id=${auth.operationId} RETURNING id`;
      if (updated.length === 0) return { ok: false, error: `Task #${data.id} no longer exists.` };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const reopenTask = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const id = Number(d.id);
    if (!Number.isFinite(id) || id <= 0) throw new Error("A valid task id is required.");
    return { id };
  })
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const updated = await db`
        UPDATE tasks SET status='to_do', updated_at=now()
        WHERE id=${data.id} AND operation_id=${auth.operationId} RETURNING id`;
      if (updated.length === 0) return { ok: false, error: `Task #${data.id} no longer exists.` };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: create/manage projects (simple named projects)
// ---------------------------------------------------------------------------

export const saveProject = createServerFn({ method: "POST" })
  .validator(parseProjectInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const p = data;
      if (p.id) {
        const updated = await db`
          UPDATE projects SET name=${p.name}, description=${p.description}
          WHERE id=${p.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Project #${p.id} no longer exists.` };
        return { ok: true, id: p.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO projects (operation_id, name, description)
        VALUES (${auth.operationId}, ${p.name}, ${p.description})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Dashboard: overdue + due-today + high-priority OPEN tasks for the operation.
// An open task is one whose status is to_do or in_progress (not completed /
// canceled). Pure helper exposed for tests + used by the server fn.
// ---------------------------------------------------------------------------

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export type BoardReason = "overdue" | "today" | "high priority";

export function dueBucket(dueDate: string | null, today: string): BoardReason | null {
  if (dueDate == null) return null;
  const diff = Math.round(
    (new Date(dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
  );
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  return null;
}

/**
 * Pure selection for the dashboard's "Today's tasks" card. Returns open tasks
 * (status to_do / in_progress) that are overdue, due today, or urgent/high
 * priority, most urgent first. Unit-testable without a database.
 */
export function selectDashboardTasks(
  tasks: Pick<Task, "id" | "title" | "status" | "priority" | "due_date" | "category" | "project_id">[],
  today: string,
  projectNames: Map<number, string> = new Map()
): DashboardTask[] {
  const open = tasks.filter((t) => t.status === "to_do" || t.status === "in_progress");
  const out: DashboardTask[] = [];
  for (const t of open) {
    const bucket = dueBucket(t.due_date, today);
    if (bucket === "overdue" || bucket === "today" || t.priority === "urgent" || t.priority === "high") {
      out.push({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        category: t.category,
        project_name: t.project_id != null ? (projectNames.get(t.project_id) ?? null) : null,
        reason: bucket === "overdue" ? "overdue" : bucket === "today" ? "today" : "high priority",
      });
    }
  }
  const rank = { overdue: 0, today: 1, "high priority": 2 } as const;
  const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return out.sort(
    (a, b) =>
      rank[a.reason as keyof typeof rank] - rank[b.reason as keyof typeof rank] ||
      priorityRank[a.priority] - priorityRank[b.priority] ||
      (a.due_date ?? "").localeCompare(b.due_date ?? "")
  );
}

/** The count + derived line shown on the dashboard card badge. */
export function dashboardCounts(tasks: DashboardTask[]): {
  overdue: number;
  dueToday: number;
  high: number;
} {
  return {
    overdue: tasks.filter((t) => t.reason === "overdue").length,
    dueToday: tasks.filter((t) => t.reason === "today").length,
    high: tasks.filter((t) => t.reason === "high priority").length,
  };
}

export const getDashboardTasks = createServerFn().handler(async (): Promise<{
  configured: boolean;
  error?: string;
  tasks: DashboardTask[];
}> => {
  if (!isDatabaseConfigured()) return { configured: false, tasks: [] };
  try {
    const auth = await requireAuth();
    const db = sql();
    const [taskRows, projectRows] = await Promise.all([
      db`
        SELECT t.id, t.title, t.status, t.priority,
               to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.category, t.project_id
        FROM tasks t
        WHERE t.operation_id = ${auth.operationId}
        ORDER BY t.due_date NULLS LAST, t.id DESC`,
      db`SELECT id, name FROM projects WHERE operation_id = ${auth.operationId}`,
    ]);
    const projectNames = new Map<number, string>(projectRows.map((p) => [Number(p.id), String(p.name)]));
    const all = taskRows as unknown as Pick<
      Task,
      "id" | "title" | "status" | "priority" | "due_date" | "category" | "project_id"
    >[];
    return { configured: true, tasks: selectDashboardTasks(all, todayStr(), projectNames) };
  } catch (err) {
    return { configured: false, error: err instanceof Error ? err.message : String(err), tasks: [] };
  }
});