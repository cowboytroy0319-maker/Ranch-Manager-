// ============================================================================
// Ranch Manager Pro — "Today's tasks" card for the Daily Operations dashboard.
// Surfaces the operation's OPEN tasks that are overdue, due today, or urgent/
// high priority (selection lives in server/tasks.ts selectDashboardTasks).
// Each row links to /tasks so a tap lands on the full filtered list.
// ============================================================================
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle } from "~/components/ui";
import { dashboardCounts } from "~/server/tasks";
import { PRIORITY_LABEL } from "~/types/tasks";
import type { DashboardTask } from "~/types/tasks";

const reasonTone: Record<string, "red" | "amber" | "blue"> = {
  overdue: "red",
  today: "amber",
  "high priority": "blue",
};

const reasonLabel: Record<string, string> = {
  overdue: "Overdue",
  today: "Due today",
  "high priority": "High priority",
};

const priorityBadge = (p: string): "red" | "amber" | "stone" =>
  p === "urgent" ? "red" : p === "high" ? "amber" : "stone";

export function TasksSnapshot({ tasks }: { tasks: DashboardTask[] }) {
  const counts = dashboardCounts(tasks);
  const headline =
    counts.overdue > 0
      ? `${counts.overdue} overdue · ${counts.dueToday} due today`
      : counts.dueToday > 0
      ? `${counts.dueToday} due today · ${counts.high} high-priority`
      : `${counts.high} high-priority open task${counts.high === 1 ? "" : "s"}`;

  return (
    <Card className={tasks.some((t) => t.reason === "overdue") ? "border-red-200 bg-red-50/30" : ""}>
      <CardTitle
        title="Today's tasks"
        sub={headline}
        right={
          tasks.length > 0 ? (
            <Badge tone={counts.overdue > 0 ? "red" : counts.dueToday > 0 ? "amber" : "blue"}>
              {tasks.length} to handle
            </Badge>
          ) : (
            <Badge tone="green">All clear</Badge>
          )
        }
      />
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
          Nothing overdue or due today. Add a task on the{" "}
          <Link to="/tasks" className="font-semibold text-green-700 hover:text-green-900">
            Tasks
          </Link>{" "}
          page and it&apos;ll show up here when it needs handling.
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.slice(0, 8).map((t) => (
            <Link
              key={t.id}
              to="/tasks"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 bg-white px-3 py-2.5 transition hover:border-green-700/30 hover:bg-green-50/50"
            >
              <Badge tone={reasonTone[t.reason] ?? "stone"}>{reasonLabel[t.reason] ?? t.reason}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{t.title}</span>
              {t.project_name && (
                <span className="hidden text-xs text-stone-400 sm:inline">📁 {t.project_name}</span>
              )}
              <Badge tone={priorityBadge(t.priority)}>{PRIORITY_LABEL[t.priority]}</Badge>
              {t.due_date && (
                <span className="whitespace-nowrap text-xs text-stone-500">{t.due_date}</span>
              )}
            </Link>
          ))}
          {tasks.length > 8 && (
            <Link
              to="/tasks"
              className="block pt-1 text-right text-xs font-semibold text-green-700 hover:text-green-900"
            >
              + {tasks.length - 8} more — open Tasks →
            </Link>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-stone-400">
        Overdue, due-today, and urgent/high-priority open tasks from your list — tap any row to manage it on the Tasks page.
      </p>
    </Card>
  );
}