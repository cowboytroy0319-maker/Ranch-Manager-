// ============================================================================
// Ranch Manager Pro — Equipment tracking modals (log fuel + log service).
// One-column mobile-first forms (the same Modal / FooterButtons / ErrorNote
// shell as the add-equipment form) so an operator at the fuel tank or the shop
// door can record a fill-up or a service in a couple of taps.
//
// Audit Phase 2 part 2 — the restock linked-expense contract, mirrored (never
// reinvented): a required "Total cost paid" money input, the two-choice
// linked-expense selector ("Add linked expense" is on by default whenever a
// cost is present), ONE client_request_id per form-open re-sent on every
// retry, a submit button disabled from the first click until the request
// settles, and result banners that say which thing actually happened.
// Edit modals correct a record and its SAME linked ledger row; void modals
// remove both halves and say so in the confirmation.
// ============================================================================
import { useMemo, useState } from "react";
import {
  deleteFuel,
  deleteMaintenance,
  logFuel,
  logMaintenance,
  updateFuel,
  updateMaintenance,
  type FuelLogInput,
  type MaintLogInput,
} from "~/server/equipment";
import { useDraftPersistence } from "~/components/drafts";
import {
  FUEL_COST_HELPER_TEXT,
  FUEL_COST_MISSING_ERROR,
  FUEL_RECORD_ONLY_LABEL,
  SERVICE_COST_HELPER_TEXT,
  SERVICE_COST_MISSING_ERROR,
  SERVICE_RECORD_ONLY_LABEL,
  TRACKING_ADD_EXPENSE_LABEL,
  buildFuelEditSubmit,
  buildFuelSubmit,
  buildServiceEditSubmit,
  buildServiceSubmit,
  fuelCreatedMessage,
  fuelEditedMessage,
  fuelSubmitLabel,
  fuelVoidConfirmLines,
  fuelVoidedMessage,
  newTrackingRequestId,
  parseCostToCents,
  serviceCreatedMessage,
  serviceEditedMessage,
  serviceSubmitLabel,
  serviceVoidConfirmLines,
  serviceVoidedMessage,
  validateTrackingMoney,
} from "~/components/equipment/trackingUI";
import { FUEL_TYPES, MAINT_TYPES, fuelTotalCents, type EquipmentItem, type FuelEntry, type MaintenanceRecord } from "~/types/equipment";
import { ErrorNote, Modal } from "~/components/sheet-modal";

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

/** The two-choice linked-expense selector, exactly the restock pattern
 *  (FeedModals.tsx 744–771): "Add linked expense" (on by default whenever a
 *  cost is present) vs the honest record-only choice. `recordOnlyLabel` and
 *  `testPrefix` differ per record kind; the styling and behavior are shared. */
function LinkedExpenseChoice({
  addExpense,
  onAdd,
  onRecordOnly,
  recordOnlyLabel,
  testPrefix,
}: {
  addExpense: boolean;
  onAdd: () => void;
  onRecordOnly: () => void;
  recordOnlyLabel: string;
  testPrefix: string;
}) {
  return (
    <Field label="Linked expense">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Linked expense">
        <button
          type="button"
          data-testid={`${testPrefix}-add-expense`}
          aria-pressed={addExpense}
          onClick={onAdd}
          className={`min-h-11 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition ${addExpense ? "border-green-700 bg-green-800 text-white" : "border-stone-300 bg-white text-stone-700"}`}
        >
          {TRACKING_ADD_EXPENSE_LABEL}
          <span className={`block text-xs font-normal ${addExpense ? "text-green-100" : "text-stone-500"}`}>
            Adds this cost to Expenses
          </span>
        </button>
        <button
          type="button"
          data-testid={`${testPrefix}-record-only`}
          aria-pressed={!addExpense}
          onClick={onRecordOnly}
          className={`min-h-11 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition ${!addExpense ? "border-stone-700 bg-stone-800 text-white" : "border-stone-300 bg-white text-stone-700"}`}
        >
          {recordOnlyLabel}
          <span className={`block text-xs font-normal ${!addExpense ? "text-stone-300" : "text-stone-500"}`}>
            No expense is created
          </span>
        </button>
      </div>
    </Field>
  );
}

/** The restock-style footer: Cancel + the money-tracking submit, disabled from
 *  the first click until the request settles (the S3/S4 UI-side fix). */
function TrackingFooter({
  onClose,
  submitLabel,
  saving,
  submittingLabel,
  formId,
  testId,
}: {
  onClose: () => void;
  submitLabel: string;
  saving: boolean;
  submittingLabel: string;
  formId: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        data-testid={testId}
        disabled={saving}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-5"
      >
        {saving ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}

export type FuelLogDraft = {
  equipment_id: number | null;
  fuel_date: string;
  gallons: string;
  pricePerGal: string;
  /** The "Total cost paid" dollars text — "" means "follow gallons × price/gal". */
  totalCost: string;
  fuel_type: string;
  meter_hours: string;
  meter_miles: string;
  location: string;
  notes: string;
};

export function fuelDraftIncludes(d: FuelLogDraft): boolean {
  return (
    d.fuel_date !== today() ||
    d.gallons !== "" ||
    d.pricePerGal !== "" ||
    // Legacy drafts (saved before the money field existed) have no totalCost —
    // treat a missing field as blank so an old draft never counts as touched.
    (d.totalCost ?? "") !== "" ||
    d.location !== "" ||
    d.notes !== ""
  );
}

const emptyFuelDraft = (): FuelLogDraft => ({
  equipment_id: null,
  fuel_date: today(),
  gallons: "",
  pricePerGal: "",
  totalCost: "",
  fuel_type: "diesel",
  meter_hours: "",
  meter_miles: "",
  location: "",
  notes: "",
});

/** Gallons × price/gal → integer cents, or null when either is missing/invalid. */
const computedFuelCents = (gallons: string, pricePerGal: string): number | null => {
  if (gallons === "" || pricePerGal === "") return null;
  const cents = fuelTotalCents(Number(gallons), Number(pricePerGal));
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : null;
};

export function LogFuelModal({
  equipment,
  onClose,
  onSaved,
}: {
  equipment: EquipmentItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<FuelLogDraft>(emptyFuelDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ON BY DEFAULT: a cost is expected to become an expense unless the operator
  // explicitly says otherwise (the restock default, FeedModals.tsx 567).
  const [addExpense, setAddExpense] = useState(true);
  // ONE request id per form-open. Never regenerated on retry.
  const [requestId] = useState(() => newTrackingRequestId());
  const { clearDraft } = useDraftPersistence("log-fuel", form as unknown as Record<string, unknown>);

  // The money the fill-up carries: an explicitly typed cost wins; otherwise the
  // auto-computed gallons × price/gal amount is used (and shown in the field's
  // placeholder + helper), so the existing no-typing flow keeps working.
  const computedCents = useMemo(() => computedFuelCents(form.gallons, form.pricePerGal), [form.gallons, form.pricePerGal]);
  const effectiveCents = parseCostToCents(form.totalCost) ?? computedCents;
  const submitLabel = fuelSubmitLabel(effectiveCents, addExpense);

  const set = <K extends keyof FuelLogDraft>(k: K, v: FuelLogDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Cost typed → the explicit rule (restock onCostChange): blank or invalid
  // cost flips the choice to record-only; a cost flips it back on.
  const onCostChange = (value: string) => {
    set("totalCost", value);
    setAddExpense(parseCostToCents(value) !== null);
  };
  // Gallons/price changes only steer the choice while the cost field is blank
  // (the money still comes from the auto-computed amount).
  const onGallonsChange = (value: string) => {
    setForm((f) => ({ ...f, gallons: value }));
    if (form.totalCost === "") setAddExpense(computedFuelCents(value, form.pricePerGal) !== null);
  };
  const onPriceChange = (value: string) => {
    setForm((f) => ({ ...f, pricePerGal: value }));
    if (form.totalCost === "") setAddExpense(computedFuelCents(form.gallons, value) !== null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addExpense && effectiveCents === null) {
      setError(FUEL_COST_MISSING_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const payload = buildFuelSubmit(
      {
        equipment_id: form.equipment_id,
        fuel_date: form.fuel_date,
        fuel_type: (FUEL_TYPES as readonly string[]).includes(form.fuel_type)
          ? (form.fuel_type as FuelLogInput["fuel_type"])
          : "diesel",
        gallons: Number(form.gallons),
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
      },
      { clientRequestId: requestId, addExpense, costCents: effectiveCents }
    );
    const res = await logFuel({ data: payload });
    if (res.ok) {
      clearDraft();
      onSaved(fuelCreatedMessage(res).text);
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title="Log fuel"
      sub="A fill-up at the pump or tank — with a cost, it also records the linked expense"
      onClose={onClose}
      footer={
        <TrackingFooter
          onClose={onClose}
          submitLabel={submitLabel}
          saving={saving}
          submittingLabel="Logging…"
          formId="log-fuel-form"
          testId="fuel-submit"
        />
      }
    >
      <form id="log-fuel-form" data-testid="fuel-form" onSubmit={submit} className="space-y-4" noValidate>
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
              data-testid="fuel-gallons"
              value={form.gallons}
              onChange={(e) => onGallonsChange(e.target.value)}
              placeholder="48.5"
              required
            />
          </Field>
          <Field label="Price / gallon ($)">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              data-testid="fuel-price"
              value={form.pricePerGal}
              onChange={(e) => onPriceChange(e.target.value)}
              placeholder="3.79"
            />
          </Field>
          <Field label="Total cost paid" className="sm:col-span-2">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              data-testid="fuel-cost"
              aria-describedby="fuel-cost-helper"
              value={form.totalCost}
              onChange={(e) => onCostChange(e.target.value)}
              placeholder={computedCents !== null ? `≈ $${(computedCents / 100).toFixed(2)} auto-computed` : "96.00"}
            />
            <p id="fuel-cost-helper" data-testid="fuel-cost-helper" className="mt-1 text-xs text-stone-500">
              {FUEL_COST_HELPER_TEXT}
              {computedCents !== null && form.totalCost === "" ? ` ≈ $${(computedCents / 100).toFixed(2)} from gallons × price/gal.` : ""}
            </p>
          </Field>
        </div>
        <LinkedExpenseChoice
          addExpense={addExpense}
          onAdd={() => setAddExpense(true)}
          onRecordOnly={() => setAddExpense(false)}
          recordOnlyLabel={FUEL_RECORD_ONLY_LABEL}
          testPrefix="fuel"
        />
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
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<ServiceLogDraft>(emptyServiceDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ON BY DEFAULT: a cost is expected to become an expense unless the operator
  // explicitly says otherwise (the restock default).
  const [addExpense, setAddExpense] = useState(true);
  // ONE request id per form-open. Never regenerated on retry.
  const [requestId] = useState(() => newTrackingRequestId());
  const { clearDraft } = useDraftPersistence("log-service", form as unknown as Record<string, unknown>);

  const costCents = parseCostToCents(form.cost);
  const submitLabel = serviceSubmitLabel(costCents, addExpense);

  const set = <K extends keyof ServiceLogDraft>(k: K, v: ServiceLogDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Blank cost → the explicit record-only choice (a $0 expense is never created
  // silently). Typing a cost back returns to "Add linked expense".
  const onCostChange = (value: string) => {
    set("cost", value);
    setAddExpense(parseCostToCents(value) !== null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateTrackingMoney(form.cost, addExpense, SERVICE_COST_MISSING_ERROR);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const payload = buildServiceSubmit(
      {
        equipment_id: form.equipment_id ?? 0,
        service_date: form.service_date,
        service_type: (MAINT_TYPES as readonly string[]).includes(form.service_type)
          ? (form.service_type as MaintLogInput["service_type"])
          : "other",
        description: form.description.trim() || null,
        meter_hours: null,
        meter_miles: null,
        status: "done",
        next_due_date: form.next_due_date || null,
        next_due_hours: form.next_due_hours === "" ? null : Number(form.next_due_hours),
        next_due_miles: form.next_due_miles === "" ? null : Number(form.next_due_miles),
        vendor: form.vendor.trim() || null,
      },
      { clientRequestId: requestId, addExpense, costCents }
    );
    const res = await logMaintenance({ data: payload });
    if (res.ok) {
      clearDraft();
      onSaved(serviceCreatedMessage(res).text);
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title="Add service"
      sub="Oil changes, repairs, inspections — with a cost, it also records the linked expense"
      onClose={onClose}
      footer={
        <TrackingFooter
          onClose={onClose}
          submitLabel={submitLabel}
          saving={saving}
          submittingLabel="Saving…"
          formId="log-service-form"
          testId="service-submit"
        />
      }
    >
      <form id="log-service-form" data-testid="service-form" onSubmit={submit} className="space-y-4" noValidate>
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
          <Field label="Total cost paid *" className="sm:col-span-2">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              data-testid="service-cost"
              aria-describedby="service-cost-helper"
              value={form.cost}
              onChange={(e) => onCostChange(e.target.value)}
              placeholder="185.00"
            />
            <p id="service-cost-helper" data-testid="service-cost-helper" className="mt-1 text-xs text-stone-500">
              {SERVICE_COST_HELPER_TEXT}
            </p>
          </Field>
          <Field label="Vendor">
            <input className={inputCls} value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Tractor Supply / Bob's Shop" />
          </Field>
        </div>
        <LinkedExpenseChoice
          addExpense={addExpense}
          onAdd={() => setAddExpense(true)}
          onRecordOnly={() => setAddExpense(false)}
          recordOnlyLabel={SERVICE_RECORD_ONLY_LABEL}
          testPrefix="service"
        />
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

// ---------------------------------------------------------------------------
// Edit an EXISTING service record. Correcting it updates the SAME linked
// expense row (never a second one); removing the cost deletes that row —
// the restock edit precedent, RestockEditModal.
// ---------------------------------------------------------------------------

export function ServiceEditModal({
  record,
  onClose,
  onSaved,
}: {
  record: MaintenanceRecord;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [serviceDate, setServiceDate] = useState(record.service_date);
  const [serviceType, setServiceType] = useState<string>(record.service_type);
  const [costDollars, setCostDollars] = useState(record.cost_cents != null ? (record.cost_cents / 100).toFixed(2) : "");
  const [vendor, setVendor] = useState(record.vendor ?? "");
  const [description, setDescription] = useState(record.description ?? "");
  const [meterHours, setMeterHours] = useState(record.meter_hours != null ? String(record.meter_hours) : "");
  const [meterMiles, setMeterMiles] = useState(record.meter_miles != null ? String(record.meter_miles) : "");
  const [nextDueDate, setNextDueDate] = useState(record.next_due_date ?? "");
  const [nextDueHours, setNextDueHours] = useState(record.next_due_hours != null ? String(record.next_due_hours) : "");
  const [nextDueMiles, setNextDueMiles] = useState(record.next_due_miles != null ? String(record.next_due_miles) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const costCents = parseCostToCents(costDollars);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceDate) {
      setError("Service date is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateMaintenance({
      data: buildServiceEditSubmit(
        {
          id: record.id,
          service_date: serviceDate,
          service_type: (MAINT_TYPES as readonly string[]).includes(serviceType)
            ? (serviceType as MaintLogInput["service_type"])
            : "other",
          description: description.trim() || null,
          vendor: vendor.trim() || null,
          meter_hours: meterHours === "" ? null : Number(meterHours),
          meter_miles: meterMiles === "" ? null : Number(meterMiles),
          next_due_date: nextDueDate || null,
          next_due_hours: nextDueHours === "" ? null : Number(nextDueHours),
          next_due_miles: nextDueMiles === "" ? null : Number(nextDueMiles),
        },
        costCents
      ),
    });
    setSaving(false);
    if (res.ok) onSaved(serviceEditedMessage(res.expense_linked));
    else setError(res.error);
  };

  return (
    <Modal
      title={`Edit service record #${record.id}`}
      sub="Correcting this updates the same linked expense"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="service-edit-form" data-testid="service-edit-submit" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      <form id="service-edit-form" data-testid="service-edit-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service date *">
            <input type="date" className={inputCls} data-testid="service-edit-date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />
          </Field>
          <Field label="Service type *">
            <select className={inputCls} data-testid="service-edit-type" value={serviceType} onChange={(e) => setServiceType(e.target.value)} required>
              {MAINT_TYPES.map((t) => (
                <option key={t} value={t}>{cap(t)}</option>
              ))}
              {!MAINT_TYPES.includes(serviceType as never) && <option value={serviceType}>{cap(serviceType)}</option>}
            </select>
          </Field>
          <Field label="Total cost paid" className="sm:col-span-2">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              data-testid="service-edit-cost"
              aria-describedby="service-edit-cost-helper"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0.00"
            />
            <p id="service-edit-cost-helper" className="mt-1 text-xs text-stone-500">{SERVICE_COST_HELPER_TEXT}</p>
          </Field>
          <Field label="Vendor">
            <input className={inputCls} data-testid="service-edit-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label="Meter hours">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={meterHours} onChange={(e) => setMeterHours(e.target.value)} />
          </Field>
          <Field label="Meter miles">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={meterMiles} onChange={(e) => setMeterMiles(e.target.value)} />
          </Field>
          <Field label="Next due date">
            <input type="date" className={inputCls} value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
          </Field>
          <Field label="Next due hours">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={nextDueHours} onChange={(e) => setNextDueHours(e.target.value)} />
          </Field>
          <Field label="Next due miles">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={nextDueMiles} onChange={(e) => setNextDueMiles(e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className={inputCls} data-testid="service-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit an EXISTING fill-up: same contract as the service edit.
// ---------------------------------------------------------------------------

export function FuelEditModal({
  record,
  onClose,
  onSaved,
}: {
  record: FuelEntry;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [fuelDate, setFuelDate] = useState(record.fuel_date);
  const [fuelType, setFuelType] = useState<string>(record.fuel_type);
  const [gallons, setGallons] = useState(String(record.gallons));
  const [costDollars, setCostDollars] = useState(record.cost_cents != null ? (record.cost_cents / 100).toFixed(2) : "");
  const [location, setLocation] = useState(record.location ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [meterHours, setMeterHours] = useState(record.meter_hours != null ? String(record.meter_hours) : "");
  const [meterMiles, setMeterMiles] = useState(record.meter_miles != null ? String(record.meter_miles) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const costCents = parseCostToCents(costDollars);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelDate) {
      setError("Fuel date is required.");
      return;
    }
    const gal = Number(gallons);
    if (!Number.isFinite(gal) || gal <= 0) {
      setError("Gallons must be greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateFuel({
      data: buildFuelEditSubmit(
        {
          id: record.id,
          fuel_date: fuelDate,
          fuel_type: (FUEL_TYPES as readonly string[]).includes(fuelType)
            ? (fuelType as FuelLogInput["fuel_type"])
            : "diesel",
          gallons: gal,
          location: location.trim() || null,
          notes: notes.trim() || null,
          meter_hours: meterHours === "" ? null : Number(meterHours),
          meter_miles: meterMiles === "" ? null : Number(meterMiles),
        },
        costCents
      ),
    });
    setSaving(false);
    if (res.ok) onSaved(fuelEditedMessage(res.expense_linked));
    else setError(res.error);
  };

  return (
    <Modal
      title={`Edit fill-up #${record.id}`}
      sub="Correcting this updates the same linked expense"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="fuel-edit-form" data-testid="fuel-edit-submit" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      <form id="fuel-edit-form" data-testid="fuel-edit-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fuel date *">
            <input type="date" className={inputCls} data-testid="fuel-edit-date" value={fuelDate} onChange={(e) => setFuelDate(e.target.value)} required />
          </Field>
          <Field label="Fuel type *">
            <select className={inputCls} data-testid="fuel-edit-type" value={fuelType} onChange={(e) => setFuelType(e.target.value)} required>
              {FUEL_TYPES.map((t) => (
                <option key={t} value={t}>{cap(t)}</option>
              ))}
              {!FUEL_TYPES.includes(fuelType as never) && <option value={fuelType}>{cap(fuelType)}</option>}
            </select>
          </Field>
          <Field label="Gallons *">
            <input
              type="number" min={0} step={0.1} inputMode="decimal"
              className={inputCls}
              data-testid="fuel-edit-gallons"
              value={gallons}
              onChange={(e) => setGallons(e.target.value)}
              required
            />
          </Field>
          <Field label="Total cost paid">
            <input
              type="number" min={0} step={0.01} inputMode="decimal"
              className={inputCls}
              data-testid="fuel-edit-cost"
              aria-describedby="fuel-edit-cost-helper"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0.00"
            />
            <p id="fuel-edit-cost-helper" className="mt-1 text-xs text-stone-500">{FUEL_COST_HELPER_TEXT}</p>
          </Field>
          <Field label="Odometer / meter — miles">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={meterMiles} onChange={(e) => setMeterMiles(e.target.value)} />
          </Field>
          <Field label="Odometer / meter — hours">
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={meterHours} onChange={(e) => setMeterHours(e.target.value)} />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Void a service record / fill-up: the linked expense and the record are
// removed TOGETHER, and the confirmation states BOTH halves (the restock void
// precedent, VoidRestockModal).
// ---------------------------------------------------------------------------

export function VoidServiceModal({
  record,
  onClose,
  onVoided,
}: {
  record: MaintenanceRecord;
  onClose: () => void;
  onVoided: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = record.expense_id != null;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const res = await deleteMaintenance({ data: record.id });
    setSaving(false);
    if (res.ok) onVoided(serviceVoidedMessage(res.linked_expense_removed));
    else setError(res.error);
  };

  return (
    <Modal
      title="Void this service record?"
      sub={`Record #${record.id} — ${record.service_type} on ${record.service_date}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="button" onClick={confirm} data-testid="service-void-confirm" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Voiding…" : "Void service record"}
          </button>
        </div>
      }
    >
      {error && <ErrorNote error={error} />}
      <ul className="space-y-1.5 text-sm text-stone-700">
        {serviceVoidConfirmLines(linked, record.expense_amount_cents ?? record.cost_cents).map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>
    </Modal>
  );
}

export function VoidFuelModal({
  record,
  onClose,
  onVoided,
}: {
  record: FuelEntry;
  onClose: () => void;
  onVoided: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = record.expense_id != null;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const res = await deleteFuel({ data: record.id });
    setSaving(false);
    if (res.ok) onVoided(fuelVoidedMessage(res.linked_expense_removed));
    else setError(res.error);
  };

  return (
    <Modal
      title="Void this fill-up?"
      sub={`Record #${record.id} — ${record.gallons} gal on ${record.fuel_date}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="button" onClick={confirm} data-testid="fuel-void-confirm" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Voiding…" : "Void fill-up"}
          </button>
        </div>
      }
    >
      {error && <ErrorNote error={error} />}
      <ul className="space-y-1.5 text-sm text-stone-700">
        {fuelVoidConfirmLines(linked, record.expense_amount_cents ?? record.cost_cents).map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>
    </Modal>
  );
}
