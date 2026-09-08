// ============================================================================
// Ranch Manager Pro — Pasture add/edit modal (create + edit paddocks).
// Mobile-first bottom sheet with a sticky labeled Save bar (safe-area padded),
// decimal input mode on acreage, draft preservation, and the same
// stone/green language as the feed module modals.
// ============================================================================
import { useState } from "react";
import { savePasture, type PastureInput } from "~/server/pasture";
import { useDraftPersistence, draftKey } from "~/components/drafts";
import { PASTURE_CONDITIONS, WATER_STATUSES, type Pasture } from "~/types/pasture";
import { FooterButtons, Modal, ErrorNote } from "~/components/sheet-modal";

const labelCls = "block text-xs font-semibold uppercase tracking-wide text-stone-500";
const inputCls =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20";
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
    size_acres: editing?.size_acres ?? null,
    location: editing?.location ?? "",
    status: editing?.status ?? "resting",
    pasture_type: editing?.pasture_type ?? "",
    capacity_heads: editing?.capacity_heads ?? null,
    water_status: editing?.water_status ?? "unknown",
    condition: editing?.condition ?? "good",
    soil_type: editing?.soil_type ?? "",
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearDraft } = useDraftPersistence(
    draftKey(editing ? `edit-pasture-${editing.id}` : "add-pasture"),
    form as unknown as Record<string, string | number | null>
  );
  const set = <K extends keyof PastureInput>(k: K, v: PastureInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await savePasture({ data: { ...form, id: form.id ?? undefined } });
    setSaving(false);
    if (res.ok) {
      clearDraft();
      onSaved();
    } else setError(res.error);
  };
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add pasture / paddock"}
      sub={editing ? `Paddock #${editing.id} — ${editing.size_acres} acres on record` : "New paddock in the live database"}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmitLabel={editing ? "Save changes" : "Add pasture"}
          saving={saving}
          formId="pasture-form"
        />
      }
    >
      <form id="pasture-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
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
          <Field label="Acreage (acres)">
            <input
              type="number" min={0} step={0.01}
              inputMode="decimal"
              className={inputCls}
              value={form.size_acres === null ? "" : form.size_acres}
              onChange={(e) => set("size_acres", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="120.5"
            />
            <p className="mt-1 text-xs text-stone-500">Optional — must be greater than zero when entered.</p>
          </Field>
          <Field label="Pasture type / use">
            <input className={inputCls} value={form.pasture_type ?? ""} onChange={(e) => set("pasture_type", e.target.value)} placeholder="Native range, hay ground, trap…" />
          </Field>
          <Field label="Capacity (head)">
            <input
              type="number" min={0} step={1}
              inputMode="numeric"
              className={inputCls}
              value={form.capacity_heads === null ? "" : form.capacity_heads}
              onChange={(e) => set("capacity_heads", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="120"
            />
          </Field>
          <Field label="Water status">
            <select className={inputCls} value={form.water_status} onChange={(e) => set("water_status", e.target.value as Pasture["water_status"])}>
              {WATER_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")[0].toUpperCase() + s.replace(/_/g, " ").slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Condition">
            <select className={inputCls} value={form.condition} onChange={(e) => set("condition", e.target.value as Pasture["condition"])}>
              {PASTURE_CONDITIONS.map((s) => (
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
      </form>
    </Modal>
  );
}