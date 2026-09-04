// ============================================================================
// Ranch Manager Pro — Tasks & Projects (protected route, live Postgres).
// Quick-add task card (title/due/priority/category + expandable details),
// filterable task list with one-tap complete/reopen and inline edit, and a
// simple projects manager. Every mutation goes through the tasks server fns
// (saveTask/updateTask/completeTask/reopenTask/saveProject), which scope by
// the session operation; after a save the loader is re-fetched so the list
// reflects the database.
// ============================================================================
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { TaskForm, type LinkLists, type TaskFormValue } from "~/components/tasks/TaskForm";
import {
  completeTask,
  getTasksData,
  reopenTask,
  saveProject,
  saveTask,
  updateTask,
  type TaskInput,
} from "~/server/tasks";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "~/types/tasks";

export const Route = createFileRoute("/tasks")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getTasksData(),
  component: TasksPage,
});

const statusTone: Record<string, "green" | "amber" | "stone" | "red"> = {
  to_do: "stone",
  in_progress: "amber",
  completed: "green",
  canceled: "red",
};

const priorityTone: Record<string, "stone" | "amber" | "red"> = {
  low: "stone",
  normal: "stone",
  high: "amber",
  urgent: "red",
};

const timeLabel = (due: string | null): string => {
  if (!due) return "";
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(due + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
  );
  if (diff < 0) return `Overdue · ${-diff}d`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due ${due}`;
};

const dueTextCls = (due: string | null): string => {
  if (!due) return "";
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(due + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
  );
  if (diff < 0) return "font-semibold text-red-600";
  if (diff === 0) return "font-semibold text-amber-700";
  return "text-stone-500";
};

function TasksPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  // ----- filters (status / priority / due / category / project) -----
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dueFilter, setDueFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  // ----- editing state -----
  const [editing, setEditing] = useState<Task | null>(null);

  const links: LinkLists = useMemo(
    () => ({ projects: data.projects, pastures: data.pastures, equipment: data.equipment, animals: data.animals }),
    [data.projects, data.pastures, data.equipment, data.animals]
  );

  const isOpen = (t: Task): boolean => t.status === "to_do" || t.status === "in_progress";

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...data.tasks]
      .sort((a, b) => {
        // open tasks first, then by due date (nulls last), then newest.
        if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
        if ((a.due_date ?? "") < (b.due_date ?? "")) return -1;
        if ((a.due_date ?? "") > (b.due_date ?? "")) return 1;
        return b.id - a.id;
      })
      .filter((t) => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
        if (dueFilter !== "all") {
          const od = t.due_date !== null && t.due_date < today;
          if (dueFilter === "overdue" && !od) return false;
          if (dueFilter === "today" && t.due_date !== today) return false;
          if (dueFilter === "upcoming" && (t.due_date === null || t.due_date <= today)) return false;
          if (dueFilter === "none" && t.due_date !== null) return false;
        }
        if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
        if (projectFilter !== "all") {
          if (projectFilter === "none") {
            if (t.project_id !== null) return false;
          } else if (String(t.project_id) !== projectFilter) return false;
        }
        return true;
      });
  }, [data.tasks, statusFilter, priorityFilter, dueFilter, categoryFilter, projectFilter]);

  const openCount = data.tasks.filter((t) => isOpen(t)).length;
  const overdueCount = data.tasks.filter((t) => isOpen(t) && t.due_date !== null && t.due_date < new Date().toISOString().slice(0, 10)).length;
  const projectCount = data.projects.length;

  const runTaskAction = async (fn: () => Promise<{ ok: boolean; error?: string }>, onErr: (e: string) => void) => {
    const res = await fn();
    if (!res.ok && res.error) onErr(res.error);
    refresh();
  };

  const handleQuickSubmit = async (input: TaskInput): Promise<string | null> => {
    const res = await saveTask({ data: input });
    if (res.ok) {
      refresh();
      return null;
    }
    return res.error;
  };

  const handleEditSubmit = async (input: TaskInput): Promise<string | null> => {
    const res = await updateTask({ data: { ...input, id: editing?.id ?? input.id } });
    if (res.ok) {
      refresh();
      setEditing(null);
      return null;
    }
    return res.error;
  };

  const handleProjectSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const res = await saveProject({ data: { name, description: String(form.get("description") ?? "").trim() || null } });
    if (!res.ok) {
      setProjectError(res.error);
      return;
    }
    setProjectError(null);
    e.currentTarget.reset();
    refresh();
  };

  const [projectError, setProjectError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ----- states -----
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="✅ Database not configured"
            sub="Tasks & projects persist to Postgres — no connection string is set in this environment."
          />
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-stone-700">
            <li>
              Set <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to a Postgres
              connection string.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:migrate</code> to create the
              projects &amp; tasks tables (migration 0015).
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-500">
            Meanwhile, the <Link to="/demo" className="font-semibold text-green-700 hover:text-green-900">interactive demo</Link>{" "}
            shows the same workflows with sample data.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
            <Link to="/demo" className="btn-primary !px-4 !py-2 text-sm">Open demo</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.error) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-red-300 bg-red-50">
          <CardTitle title="Database error" sub="The database is configured but the task records could not be read." />
          <pre className="overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-red-800">{data.error}</pre>
          <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={String(openCount)} sub={`${data.tasks.length} total on record`} accent={openCount > 0} />
        <Stat label="Overdue" value={String(overdueCount)} sub="open &amp; past due" accent={overdueCount > 0} />
        <Stat label="Completed" value={String(data.tasks.filter((t) => t.status === "completed").length)} sub="closed out" />
        <Stat label="Projects" value={String(projectCount)} sub="group related work" />
      </div>

      {/* Quick add */}
      <Card className="border-green-700/20 bg-green-50/40">
        <CardTitle title="＋ Add a task" sub="Title, due date, priority, category — details expand when you need them." />
        <TaskForm
          compact
          links={links}
          submitLabel="Add task"
          onSubmit={handleQuickSubmit}
        />
      </Card>

      {/* Filters + list */}
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <CardTitle title="Task list" sub="Open tasks first, soonest due date first" />
          <div className="ml-auto flex flex-wrap gap-2">
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[["all", "All statuses"], ...TASK_STATUSES.map((s) => [s, STATUS_LABEL[s]] as const)]} />
            <FilterSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={[["all", "All priorities"], ...TASK_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const)]} />
            <FilterSelect label="Due" value={dueFilter} onChange={setDueFilter} options={[["all", "All dates"], ["overdue", "Overdue"], ["today", "Due today"], ["upcoming", "Upcoming"], ["none", "No due date"]]} />
            <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} options={[["all", "All categories"], ...TASK_CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]] as const)]} />
            <FilterSelect label="Project" value={projectFilter} onChange={setProjectFilter} options={[["all", "All projects"], ["none", "No project"], ...data.projects.map((p) => [String(p.id), p.name] as const)]} />
          </div>
        </div>

        {actionError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
        )}

        {filtered.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-stone-300 p-6 text-center">
            {data.tasks.length === 0 ? (
              <div className="space-y-2">
                <p className="text-2xl">📝</p>
                <p className="text-sm font-semibold text-stone-700">No tasks yet — your day starts here.</p>
                <p className="mx-auto max-w-md text-sm text-stone-500">
                  Use the <span className="font-medium text-green-700">+ Add a task</span> card above to jot down the first thing on
                  today&apos;s list — pulling calves, a pasture move, fence work, an oil change, or tomorrow&apos;s paperwork. Saved
                  tasks land in this list and flow to the Daily Operations dashboard once they&apos;re overdue, due today, or high priority.
                </p>
              </div>
            ) : (
              <p className="text-sm text-stone-500">No tasks match the current filters.</p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {filtered.map((t) => {
              const open = isOpen(t);
              return (
                <div
                  key={t.id}
                  className={`flex flex-wrap items-start gap-3 rounded-xl border px-3 py-3 transition ${
                    open
                      ? "border-stone-200 bg-white hover:border-green-700/30 hover:bg-green-50/40"
                      : "border-stone-100 bg-stone-50/60 opacity-70"
                  }`}
                >
                  {/* one-tap complete / reopen */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const fn = () => (t.status === "completed" ? reopenTask({ data: { id: t.id } }) : completeTask({ data: { id: t.id } }));
                      void runTaskAction(fn, setActionError);
                    }}
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-lg transition"
                    title={t.status === "completed" ? "Reopen task" : "Mark complete"}
                    aria-label={t.status === "completed" ? "Reopen task" : "Mark complete"}
                  >
                    {t.status === "completed" ? (
                      <span className="translate-y-[-1px] text-green-700">↺</span>
                    ) : (
                      <span className="border border-stone-300 text-transparent">✓</span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`cursor-pointer text-sm font-semibold ${
                          t.status === "completed"
                            ? "text-stone-400 line-through"
                            : t.status === "canceled"
                            ? "text-stone-400 line-through"
                            : "text-stone-900"
                        }`}
                        onClick={() => setEditing(t)}
                        title="Edit task"
                      >
                        {t.title}
                      </span>
                      <Badge tone={statusTone[t.status] ?? "stone"}>{STATUS_LABEL[t.status]}</Badge>
                      {t.priority !== "normal" && (
                        <Badge tone={priorityTone[t.priority] ?? "stone"}>{PRIORITY_LABEL[t.priority]}</Badge>
                      )}
                      <Badge tone="stone">{CATEGORY_LABEL[t.category] ?? t.category}</Badge>
                      {t.project_name && <Badge tone="blue">📁 {t.project_name}</Badge>}
                    </div>
                    <p className={`mt-0.5 text-xs ${dueTextCls(t.due_date)}`}>
                      {t.due_date ? timeLabel(t.due_date) : "No due date"}
                    </p>
                    {t.description && <p className="mt-1 text-sm text-stone-600">{t.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
                      {t.pasture_name && <span>🌿 {t.pasture_name}</span>}
                      {t.equipment_name && <span>🚜 {t.equipment_name}</span>}
                      {t.animal_name && <span>🐄 {t.animal_name}</span>}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(t);
                    }}
                    className="shrink-0 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                  >
                    Edit
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-stone-400">
          {filtered.length} shown of {data.tasks.length} tasks · tap the circle to complete, ✎ Edit to change details · saved to live Postgres
        </p>
      </Card>

      {/* Projects */}
      <Card>
        <CardTitle title="Projects" sub="Simple named projects to group related work — one or two words is plenty." />
        <form onSubmit={handleProjectSubmit} className="flex flex-wrap items-start gap-2">
          <input
            name="name"
            placeholder="New project (e.g. “2026 Fence Build”)"
            className="w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20"
            required
          />
          <input
            name="description"
            placeholder="Optional note"
            className="w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20"
          />
          <button type="submit" className="btn-primary !px-4 !py-2 text-sm">Create project</button>
        </form>
        {projectError && <p className="mt-2 text-xs text-red-600">{projectError}</p>}
        {data.projects.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            No projects yet — create one above, then pick it in a task&apos;s details.
          </p>
        ) : (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <div key={p.id} className="rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2.5">
                <p className="text-sm font-semibold text-stone-800">📁 {p.name}</p>
                {p.description && <p className="mt-0.5 text-xs text-stone-500">{p.description}</p>}
                <p className="mt-1 text-[11px] text-stone-400">
                  {data.tasks.filter((t) => t.project_id === p.id).length} task
                  {data.tasks.filter((t) => t.project_id === p.id).length === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-3 sm:p-6" onClick={() => setEditing(null)}>
          <Card className="my-4 w-full max-w-xl shadow-xl">
            <div onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-stone-900">Edit task</h3>
                  <p className="text-sm text-stone-500">Task #{editing.id} — changes go straight to the database.</p>
                </div>
                <button onClick={() => setEditing(null)} className="rounded-lg border border-stone-200 px-2.5 py-1 text-sm text-stone-500 transition hover:bg-stone-100" aria-label="Close">
                  ✕
                </button>
              </div>
              <TaskForm
                initial={editing as TaskFormValue}
                links={links}
                submitLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSubmit={handleEditSubmit}
              />
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (readonly [string, string])[];
}) {
  return (
    <select
      aria-label={label}
      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700 sm:w-auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map(([val, text]) => (
        <option key={val} value={val}>{text}</option>
      ))}
    </select>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      badge="Tasks &amp; Projects"
      eyebrow="Daily to-do, on the record"
      title="Tasks &amp; Projects"
      subtitle="The day's list — what's overdue, what's due today, and the projects that group it — from the gate to the shop."
    >
      {children}
    </AppShell>
  );
}