// ============================================================================
// Ranch Manager Pro — Employees add/edit modal. Plain controlled form; Tailwind
// stone/green language. Uses the same form conventions as the livestock module.
// ============================================================================
import { useState } from "react";
import { Card } from "~/components/ui";
import { saveEmployee } from "~/server/employees";
import { PAY_TYPES, type EmployeeInput, type EmployeeRow, type HerdGroupRef, type PayType } from "~/types/employees";

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

function ErrorNote({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
  );
}

const numOrNull = (v: string): number | null => (v === "" ? null : Number(v));

export function EmployeeFormModal({
  editing,
  groups,
  onClose,
  onSaved,
}: {
  editing: EmployeeRow | null;
  groups: HerdGroupRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EmployeeInput>({
    id: editing?.id,
    name: editing?.name ?? "",
    role: editing?.role ?? "",
    pay_type: editing?.pay_type ?? "hourly",
    wage_rate: editing?.wage_rate ?? null,
    hours: editing?.hours ?? null,
    salary_amount: editing?.salary_amount ?? null,
    contract_amount: editing?.contract_amount ?? null,
    crew: editing?.crew ?? "",
    hire_date: editing?.hire_date ?? "",
    contact: editing?.contact ?? "",
    job: editing?.job ?? "",
    herd_group_id: editing?.herd_group_id ?? null,
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveEmployee({ data: { ...form, id: form.id ?? undefined } });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-3 sm:p-6" onClick={onClose}>
      <Card className="my-4 w-full max-w-xl shadow-xl">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-stone-900">{editing ? `Edit ${editing.name}` : "Add employee"}</h3>
              <p className="text-sm text-stone-500">
                {editing ? `Record #${editing.id}` : "New record in the live database"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-200 px-2.5 py-1 text-sm text-stone-500 transition hover:bg-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && <ErrorNote error={error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name *">
                <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Jesse Marlow" required />
              </Field>
              <Field label="Role">
                <input className={inputCls} value={form.role ?? ""} onChange={(e) => set("role", e.target.value)} placeholder="Cowboy / ranch hand" />
              </Field>
              <Field label="Pay type *">
                <select className={inputCls} value={form.pay_type} onChange={(e) => set("pay_type", e.target.value as PayType)}>
                  {PAY_TYPES.map((p) => (
                    <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Crew / assignment">
                <input className={inputCls} value={form.crew ?? ""} onChange={(e) => set("crew", e.target.value)} placeholder="North crew" />
              </Field>

              {form.pay_type === "hourly" && (
                <>
                  <Field label="Wage ($/hr)">
                    <input type="number" min={0} step="0.01" className={inputCls} value={form.wage_rate ?? ""} onChange={(e) => set("wage_rate", numOrNull(e.target.value))} placeholder="18.50" />
                  </Field>
                  <Field label="Hours logged">
                    <input type="number" min={0} step="0.5" className={inputCls} value={form.hours ?? ""} onChange={(e) => set("hours", numOrNull(e.target.value))} placeholder="140" />
                  </Field>
                </>
              )}
              {form.pay_type === "salary" && (
                <Field label="Monthly salary ($)" className="sm:col-span-2">
                  <input type="number" min={0} step="0.01" className={inputCls} value={form.salary_amount ?? ""} onChange={(e) => set("salary_amount", numOrNull(e.target.value))} placeholder="4800" />
                </Field>
              )}
              {form.pay_type === "contract" && (
                <Field label="Monthly contract amount ($)" className="sm:col-span-2">
                  <input type="number" min={0} step="0.01" className={inputCls} value={form.contract_amount ?? ""} onChange={(e) => set("contract_amount", numOrNull(e.target.value))} placeholder="3200" />
                </Field>
              )}

              <Field label="Job / activity">
                <input className={inputCls} value={form.job ?? ""} onChange={(e) => set("job", e.target.value)} placeholder="Feeding, Gathering…" />
              </Field>
              <Field label="Allocated herd">
                <select
                  className={inputCls}
                  value={form.herd_group_id ?? ""}
                  onChange={(e) => set("herd_group_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— none —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hire date">
                <input type="date" className={inputCls} value={form.hire_date ?? ""} onChange={(e) => set("hire_date", e.target.value)} />
              </Field>
              <Field label="Contact">
                <input className={inputCls} value={form.contact ?? ""} onChange={(e) => set("contact", e.target.value)} placeholder="phone / email" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Disposition, availability, special skills…" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
              <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save changes" : "Add employee"}
              </button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
