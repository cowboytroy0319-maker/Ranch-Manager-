// ============================================================================
// Ranch Manager Pro — Pasture add/edit modal (create + edit paddocks).
// Plain controlled form; same stone/green language as the feed module modals.
// ============================================================================
import { useState } from "react";
import { Card } from "~/components/ui";
import { savePasture, type PastureInput } from "~/server/pasture";
import { PASTURE_STATUSES, type Pasture } from "~/types/pasture";

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

export function PastureFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Pasture | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PastureInput>({
    id: editing?.id,
    name: editing?.name ?? "",
    size_acres: editing?.size_acres ?? 0,
    location: editing?.location ?? "",
    status: editing?.status ?? "resting",
    soil_type: editing?.soil_type ?? "",
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PastureInput>(k: K, v: PastureInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await savePasture({ data: { ...form, id: form.id ?? undefined } });
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
              <h3 className="text-lg font-bold text-stone-900">{editing ? `Edit ${editing.name}` : "Add pasture / paddock"}</h3>
              <p className="text-sm text-stone-500">
                {editing ? `Paddock #${editing.id} — ${editing.size_acres} acres on record` : "New paddock in the live database"}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg border border-stone-200 px-2.5 py-1 text-sm text-stone-500 transition hover:bg-stone-100" aria-label="Close">
              ✕
            </button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paddock / pasture name *" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="North River Pasture"
                  required
                />
              </Field>
              <Field label="Acreage (acres) *">
                <input
                  type="number" min={0.01} step={0.01}
                  className={inputCls}
                  value={form.size_acres === 0 ? "" : form.size_acres}
                  onChange={(e) => set("size_acres", e.target.value === "" ? 0 : Number(e.target.value))}
                  placeholder="120.5"
                  required
                />
                <p className="mt-1 text-xs text-stone-500">Must be greater than zero.</p>
              </Field>
              <Field label="Status">
                <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as Pasture["status"])}>
                  {PASTURE_STATUSES.map((s) => (
                    <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Location">
                <input className={inputCls} value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="South quarter — off County Rd 12" />
              </Field>
              <Field label="Soil / forage type">
                <input className={inputCls} value={form.soil_type ?? ""} onChange={(e) => set("soil_type", e.target.value)} placeholder="Sandy loam · bermudagrass" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Fence condition, water source, stocking notes…" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
              <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save changes" : "Add pasture"}
              </button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}