// ============================================================================
// Ranch Manager Pro — Task add/edit form (shared by the quick-add card and the
// edit modal on /tasks). Plain controlled form in the site's stone/green
// language; `compact` starts with just title/due/priority/category and an
// "Add details" toggle for description/status/project/links.
// ============================================================================
import { useState } from "react";
import type { TaskInput } from "~/server/tasks";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "~/types/tasks";

const labelCls = "block text-xs font-semibold uppercase tracking-wide text-stone-500";
const inputCls =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export type TaskFormValue = {
  id?: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  category: TaskCategory;
  project_id: number | "";
  pasture_id: number | "";
  equipment_id: number | "";
  animal_id: number | "";
};

export type LinkLists = {
  projects: { id: number; name: string }[];
  pastures: { id: number; name: string }[];
  equipment: { id: number; name: string }[];
  animals: { id: number; name: string }[];
};

/**
 * Controlled task form. `initial` pre-fills for edits. `compact` hides the
 * detail fields behind a toggle (quick add). `onSubmit` receives the parsed
 * TaskInput server payload and must return a user-facing error string or null.
 */
export function TaskForm({
  initial,
  links,
  compact = false,
  submitLabel = "Save task",
  onSubmit,
  onCancel,
}: {
  initial?: Partial<TaskFormValue>;
  links: LinkLists;
  compact?: boolean;
  submitLabel?: string;
  onSubmit: (input: TaskInput) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<TaskFormValue>({
    id: initial?.id,
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    status: initial?.status ?? "to_do",
    priority: initial?.priority ?? "normal",
    due_date: initial?.due_date ?? "",
    category: initial?.category ?? "general",
    project_id: initial?.project_id ?? "",
    pasture_id: initial?.pasture_id ?? "",
    equipment_id: initial?.equipment_id ?? "",
    animal_id: initial?.animal_id ?? "",
  });
  const [showDetails, setShowDetails] = useState(!compact);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TaskFormValue>(k: K, v: TaskFormValue[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: TaskInput = {
      id: form.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      due_date: form.due_date || null,
      category: form.category,
      project_id: form.project_id === "" ? null : form.project_id,
      pasture_id: form.pasture_id === "" ? null : form.pasture_id,
      equipment_id: form.equipment_id === "" ? null : form.equipment_id,
      animal_id: form.animal_id === "" ? null : form.animal_id,
    };
    // Trim + guard: task title is required client-side (server rejects it too).
    if (!input.title) {
      setError("Task title is required.");
      setSaving(false);
      return;
    }
    const err = await onSubmit(input);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task title *" className="sm:col-span-2">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Pull and tag replacement heifers"
            autoFocus
            required
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            className={inputCls}
            value={form.due_date}
            onChange={(e) => set("due_date", e.target.value)}
          />
        </Field>
        <Field label="Priority">
          <select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value as TaskCategory)}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Field>
      </div>

      {compact && (
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-sm font-semibold text-green-700 transition hover:text-green-900"
        >
          {showDetails ? "– Hide details" : "+ Add details (status, project, links)"}
        </button>
      )}

      {showDetails && (
        <div className="grid gap-4 rounded-xl border border-stone-100 bg-stone-50/50 p-4 sm:grid-cols-2">
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select className={inputCls} value={form.project_id} onChange={(e) => set("project_id", e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— none —</option>
              {links.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Linked pasture" className="sm:col-span-2">
            <select className={inputCls} value={form.pasture_id} onChange={(e) => set("pasture_id", e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— none —</option>
              {links.pastures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Linked equipment/vehicle">
            <select className={inputCls} value={form.equipment_id} onChange={(e) => set("equipment_id", e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— none —</option>
              {links.equipment.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Linked animal">
            <select className={inputCls} value={form.animal_id} onChange={(e) => set("animal_id", e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— none —</option>
              {links.animals.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Description / notes" className="sm:col-span-2">
            <textarea
              className={inputCls}
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Details that make the task actionable at the gate or shop…"
            />
          </Field>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-outline !px-4 !py-2">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="btn-primary !px-5 !py-2.5 disabled:opacity-60"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}