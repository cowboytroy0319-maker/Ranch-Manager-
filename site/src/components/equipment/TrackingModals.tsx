// ============================================================================
// Ranch Manager Pro — Equipment tracking modals (log fuel + log service).
// One-column mobile-first forms (the same Modal / FooterButtons / ErrorNote
// shell as the add-equipment form) so an operator at the fuel tank or the shop
// door can record a fill-up or a service in a couple of taps. Both submit to
// the existing operation-scoped server writes (logFuel / logMaintenance) via
// INSERT…SELECT…WHERE e.id AND e.operation_id = auth.operationId. Drafts are
// preserved across an accidental close (useDraftPersistence, same as the other
// module forms).
// ============================================================================
import { useMemo, useState } from "react";
import { logFuel, logMaintenance, type FuelLogInput, type MaintLogInput } from "~/server/equipment";
import { useDraftPersistence } from "~/components/drafts";
import { FUEL_TYPES, MAINT_TYPES, fuelTotalCents, type EquipmentItem } from "~/types/equipment";
import { ErrorNote, FooterButtons, Modal } from "~/components/sheet-modal";

export { fuelTotalCents } from "~/types/equipment";

const today = (): string => new Date().toISOString().slice(0, 10);

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

/** Options for the equipment picker — name plus a make/model hint when the
 * fleet has several units that share a name. */
export function equipmentOptionLabel(eq: EquipmentItem): string {
  const hint = [eq.year, eq.make, eq.model].filter(Boolean).join(" ");
  return hint ? `${eq.name} — ${hint}` : eq.name;
}

export function EquipmentPicker({
  equipment,
  value,
  onChange,
  label = "Equipment *",
  includeUnassigned = false,
}: {
  equipment: EquipmentItem[];
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  includeUnassigned?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        className={inputCls}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        required={!includeUnassigned}
      >
        {includeUnassigned && <option value="">— not assigned to a machine —</option>}
        {!includeUnassigned && value === null && <option value="">Pick a unit…</option>}
        {equipment.map((eq) => (
          <option key={eq.id} value={eq.id}>
            {equipmentOptionLabel(eq)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export type FuelLogDraft = {
  equipment_id: number | null;
  fuel_date: string;
  gallons: string;
  pricePerGal: string;
  fuel_type: string;
  meter_hours: string;
  meter_miles: string;
  location: string;
  notes: string;
};

export function fuelDraftIncludes(d: FuelLogDraft): boolean {
  return d.fuel_date !== today() || d.gallons !== "" || d.pricePerGal !== "" || d.location !== "" || d.notes !== "";
}

const emptyFuelDraft = (): FuelLogDraft => ({
  equipment_id: null,
  fuel_date: today(),
  gallons: "",
  pricePerGal: "",
  fuel_type: "diesel",
  meter_hours: "",
  meter_miles: "",
  location: "",
  notes: "",
});

export function LogFuelModal({
  equipment,
  onClose,
  onSaved,
}: {
  equipment: EquipmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FuelLogDraft>(emptyFuelDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearDraft } = useDraftPersistence("log-fuel", form as unknown as Record<string, unknown>);

  const totalCents = useMemo(() => {
    const g = Number(form.gallons);
    const p = Number(form.pricePerGal);
    return fuelTotalCents(g, p);
  }, [form.gallons, form.pricePerGal]);
  const showTotal = Number.isFinite(totalCents) && form.gallons !== "" && form.pricePerGal !== "";

  const set = <K extends keyof FuelLogDraft>(k: K, v: FuelLogDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: FuelLogInput = {
      equipment_id: form.equipment_id,
      fuel_date: form.fuel_date,
      fuel_type: (FUEL_TYPES as readonly string[]).includes(form.fuel_type)
        ? (form.fuel_type as FuelLogInput["fuel_type"])
        : "diesel",
      gallons: Number(form.gallons),
      cost_cents: Number.isFinite(totalCents) ? totalCents : null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    };
    const res = await logFuel({ data: payload });
    setSaving(false);
    if (res.ok) {
      clearDraft();
      onSaved();
    } else setError(res.error);
  };

  return (
    <Modal
      title="Log fuel"
      sub="A fill-up at the pump or tank — counts toward per-machine fuel costs"
      onClose={onClose}
      footer={
        <FooterButtons onCancel={onClose} onSubmitLabel="Log fill-up" saving={saving} submittingLabel="Logging…" formId="log-fuel-form" />
      }
    >
      <form id="log-fuel-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <EquipmentPicker equipment={equipment} value={form.equipment_id} onChange={(id) => set("equipment_id", id)} />
        <Field label="Date *">
          <input type="date" className={inputCls} value={form.fuel_date} onChange={(e) => set("fuel_date", e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gallons *">
            <input
              type="number" min={0} step={0.1} inputMode="decimal"
              className={inputCls}
              value={form.gallons}
              onChange={(e) => set("gallons", e.target.value)}
              placeholder="48.5"
              required
            />
          </Field>
          <Field label="Price / gallon ($)">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              value={form.pricePerGal}
              onChange={(e) => set("pricePerGal", e.target.value)}
              placeholder="3.79"
            />
          </Field>
        </div>
        <Field label="Total cost">
          <p className={`${inputCls} bg-stone-50 font-semibold ${showTotal ? "text-stone-900" : "text-stone-400"}`}>
            {showTotal ? `$${(totalCents / 100).toFixed(2)}` : "—"} {showTotal && <span className="ml-1 font-normal text-stone-400">auto-computed</span>}
          </p>
        </Field>
        <Field label="Fuel type">
          <select className={inputCls} value={form.fuel_type} onChange={(e) => set("fuel_type", e.target.value)}>
            {FUEL_TYPES.map((t) => (
              <option key={t} value={t}>{cap(t)}</option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Odometer / meter — miles">
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls}
              value={form.meter_miles}
              onChange={(e) => set("meter_miles", e.target.value)}
              placeholder="86,400"
            />
          </Field>
          <Field label="Odometer / meter — hours">
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls}
              value={form.meter_hours}
              onChange={(e) => set("meter_hours", e.target.value)}
              placeholder="1,240"
            />
          </Field>
        </div>
        <Field label="Location">
          <input className={inputCls} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Main fuel tank" />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Paid at the pump, winter blend…" />
        </Field>
      </form>
    </Modal>
  );
}

export type ServiceLogDraft = {
  equipment_id: number | null;
  service_date: string;
  service_type: string;
  cost: string;
  vendor: string;
  next_due_miles: string;
  next_due_hours: string;
  next_due_date: string;
  description: string;
};

export function serviceDraftIncludes(d: ServiceLogDraft): boolean {
  return (
    d.service_date !== today() || d.cost !== "" || d.vendor !== "" || d.next_due_miles !== "" || d.next_due_hours !== "" || d.next_due_date !== "" || d.description !== ""
  );
}

const emptyServiceDraft = (): ServiceLogDraft => ({
  equipment_id: null,
  service_date: today(),
  service_type: "scheduled",
  cost: "",
  vendor: "",
  next_due_miles: "",
  next_due_hours: "",
  next_due_date: "",
  description: "",
});

export function LogServiceModal({
  equipment,
  onClose,
  onSaved,
}: {
  equipment: EquipmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ServiceLogDraft>(emptyServiceDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clearDraft } = useDraftPersistence("log-service", form as unknown as Record<string, unknown>);

  const set = <K extends keyof ServiceLogDraft>(k: K, v: ServiceLogDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const costDollars = form.cost.trim() === "" ? "" : Number(form.cost);
    const payload: MaintLogInput = {
      equipment_id: form.equipment_id ?? 0,
      service_date: form.service_date,
      service_type: (MAINT_TYPES as readonly string[]).includes(form.service_type)
        ? (form.service_type as MaintLogInput["service_type"])
        : "other",
      description: form.description.trim() || null,
      cost_cents: costDollars === "" || !Number.isFinite(costDollars) ? null : Math.max(0, Math.round(costDollars * 100)),
      meter_hours: null,
      meter_miles: null,
      status: "done",
      next_due_date: form.next_due_date || null,
      next_due_hours: form.next_due_hours === "" ? null : Number(form.next_due_hours),
      next_due_miles: form.next_due_miles === "" ? null : Number(form.next_due_miles),
      vendor: form.vendor.trim() || null,
    };
    const res = await logMaintenance({ data: payload });
    setSaving(false);
    if (res.ok) {
      clearDraft();
      onSaved();
    } else setError(res.error);
  };

  return (
    <Modal
      title="Add service"
      sub="Oil changes, repairs, inspections — and the next-due target"
      onClose={onClose}
      footer={
        <FooterButtons onCancel={onClose} onSubmitLabel="Add service" saving={saving} submittingLabel="Saving…" formId="log-service-form" />
      }
    >
      <form id="log-service-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <EquipmentPicker equipment={equipment} value={form.equipment_id} onChange={(id) => set("equipment_id", id)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service date *">
            <input type="date" className={inputCls} value={form.service_date} onChange={(e) => set("service_date", e.target.value)} required />
          </Field>
          <Field label="Service type *">
            <select className={inputCls} value={form.service_type} onChange={(e) => set("service_type", e.target.value)} required>
              {MAINT_TYPES.map((t) => (
                <option key={t} value={t}>{cap(t)}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost ($)">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              value={form.cost}
              onChange={(e) => set("cost", e.target.value)}
              placeholder="185.00"
            />
          </Field>
          <Field label="Vendor">
            <input className={inputCls} value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Tractor Supply / Bob's Shop" />
          </Field>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Next service due (optional)</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Miles">
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls}
              value={form.next_due_miles}
              onChange={(e) => set("next_due_miles", e.target.value)}
              placeholder="5,000"
            />
          </Field>
          <Field label="Hours">
            <input
              type="number" min={0} step={1} inputMode="numeric"
              className={inputCls}
              value={form.next_due_hours}
              onChange={(e) => set("next_due_hours", e.target.value)}
              placeholder="250"
            />
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={form.next_due_date} onChange={(e) => set("next_due_date", e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <input className={inputCls} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Oil + filter, grease, check brakes…" />
        </Field>
      </form>
    </Modal>
  );
}