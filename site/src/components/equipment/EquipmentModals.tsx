// ============================================================================
// Ranch Manager Pro — Equipment add/edit modal (create + edit fleet units).
// Mobile-first bottom sheet with a sticky labeled Save bar (safe-area padded),
// numeric input modes on year/hours/miles, draft preservation for the add
// path, and the same stone/green language as the other module modals.
// ============================================================================
import { useState } from "react";
import { saveEquipment, type EquipmentInput } from "~/server/equipment";
import { useDraftPersistence, draftKey } from "~/components/drafts";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  type EquipmentItem,
} from "~/types/equipment";
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
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const fuelOpts = ["diesel", "gasoline", "gas", "electric", "other"] as const;

export function EquipmentFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: EquipmentItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EquipmentInput>({
    id: editing?.id,
    name: editing?.name ?? "",
    category: editing?.category ?? "tractor",
    make: editing?.make ?? "",
    model: editing?.model ?? "",
    year: editing?.year ?? null,
    hours: editing?.hours ?? null,
    miles: editing?.miles ?? null,
    status: editing?.status ?? "in-service",
    location: editing?.location ?? "",
    fuel_type: editing?.fuel_type ?? null,
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearDraft } = useDraftPersistence(
    draftKey(editing ? `edit-equipment-${editing.id}` : "add-equipment"),
    form as unknown as Record<string, unknown>
  );
  const set = <K extends keyof EquipmentInput>(k: K, v: EquipmentInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveEquipment({ data: { ...form, id: form.id ?? undefined } });
    setSaving(false);
    if (res.ok) {
      clearDraft();
      onSaved();
    } else setError(res.error);
  };
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add equipment"}
      sub={editing ? `Unit #${editing.id} — ${editing.category}` : "New unit in the fleet register"}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmitLabel={editing ? "Save changes" : "Add equipment"}
          saving={saving}
          formId="equipment-form"
        />
      }
    >
      <form id="equipment-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit name *" className="sm:col-span-2">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="F-350 work truck"
              required
            />
          </Field>
          <Field label="Category / type">
            <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value as EquipmentItem["category"])}>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{cap(c)}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as EquipmentItem["status"])}>
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{cap(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Make">
            <input className={inputCls} value={form.make ?? ""} onChange={(e) => set("make", e.target.value)} placeholder="Ford" />
          </Field>
          <Field label="Model">
            <input className={inputCls} value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} placeholder="F-350" />
          </Field>
          <Field label="Year">
            <input
              type="number" min={1900} max={2100} step={1}
              inputMode="numeric"
              className={inputCls}
              value={form.year ?? ""}
              onChange={(e) => set("year", e.target.value ? Number(e.target.value) : null)}
              placeholder="2019"
            />
          </Field>
          <Field label="Fuel type">
            <select
              className={inputCls}
              value={form.fuel_type ?? ""}
              onChange={(e) => set("fuel_type", e.target.value || null)}
            >
              <option value="">— none —</option>
              {fuelOpts.map((f) => (
                <option key={f} value={f}>{cap(f)}</option>
              ))}
            </select>
          </Field>
          <Field label="Hours (meter)">
            <input
              type="number" min={0} step={1}
              inputMode="numeric"
              className={inputCls}
              value={form.hours ?? ""}
              onChange={(e) => set("hours", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="1,240"
            />
          </Field>
          <Field label="Miles (meter)">
            <input
              type="number" min={0} step={1}
              inputMode="numeric"
              className={inputCls}
              value={form.miles ?? ""}
              onChange={(e) => set("miles", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="86,400"
            />
          </Field>
          <Field label="Location" className="sm:col-span-2">
            <input className={inputCls} value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Main shop — bay 2" />
          </Field>
        </div>
        <Field label="Maintenance notes">
          <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Oil-change interval, quirks, parts history…" />
        </Field>
      </form>
    </Modal>
  );
}