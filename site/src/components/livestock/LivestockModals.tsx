// ============================================================================
// Ranch Manager Pro — Livestock modals (animal form, detail w/ health history,
// health event form). Plain controlled forms; Tailwind stone/green language.
// ============================================================================
import { useState } from "react";
import { Badge, Card } from "~/components/ui";
import { addHealthEvent, saveAnimal, type AnimalInput, type HealthEventInput } from "~/server/livestock";
import {
  ANIMAL_STATUSES,
  HEALTH_EVENT_TYPES,
  SEXES,
  SPECIES,
  type Animal,
  type HealthEvent,
  type HerdGroup,
  type Species,
} from "~/types/livestock";

const today = () => new Date().toISOString().slice(0, 10);

const labelCls = "block text-xs font-semibold uppercase tracking-wide text-stone-500";
const inputCls =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function Modal({
  title,
  sub,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-3 sm:p-6" onClick={onClose}>
      <Card
        className={`my-4 w-full ${wide ? "max-w-3xl" : "max-w-xl"} shadow-xl`}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-stone-900">{title}</h3>
              {sub && <p className="text-sm text-stone-500">{sub}</p>}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-200 px-2.5 py-1 text-sm text-stone-500 transition hover:bg-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </Card>
    </div>
  );
}

function ErrorNote({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

function speciesBadge(species: Species) {
  const emoji = { cattle: "🐄", horse: "🐎", goat: "🐐", sheep: "🐑" }[species];
  return (
    <Badge tone="stone">
      {emoji} {species[0].toUpperCase() + species.slice(1)}
    </Badge>
  );
}

const statusTone: Record<string, "green" | "amber" | "stone" | "red"> = {
  active: "green",
  pending: "amber",
  sold: "stone",
  deceased: "red",
};

// ---------------------------------------------------------------------------
// Add / edit animal
// ---------------------------------------------------------------------------

export function AnimalFormModal({
  editing,
  groups,
  pastures,
  onClose,
  onSaved,
}: {
  editing: Animal | null;
  groups: HerdGroup[];
  pastures: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AnimalInput>({
    id: editing?.id,
    species: editing?.species ?? "cattle",
    name: editing?.name ?? "",
    tag_number: editing?.tag_number ?? "",
    sex: editing?.sex ?? "",
    breed: editing?.breed ?? "",
    birth_date: editing?.birth_date ?? "",
    status: editing?.status ?? "active",
    herd_group_id: editing?.herd_group_id ?? null,
    pasture: editing?.pasture ?? "",
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AnimalInput>(k: K, v: AnimalInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const groupOptions = groups.filter((g) => g.species === form.species);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveAnimal({ data: { ...form, id: form.id ?? undefined } });
    setSaving(false);
    if (res.ok) {
      onSaved();
    } else {
      setError(res.error);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add animal"}
      sub={editing ? `Record #${editing.id}` : "New record in the live database"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Species *">
            <select className={inputCls} value={form.species} onChange={(e) => { set("species", e.target.value); set("herd_group_id", null); }}>
              {SPECIES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {ANIMAL_STATUSES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Name *">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Belle / SV-104" required />
          </Field>
          <Field label="Ear tag">
            <input className={inputCls} value={form.tag_number ?? ""} onChange={(e) => set("tag_number", e.target.value)} placeholder="SV-101" />
          </Field>
          <Field label="Sex">
            <select className={inputCls} value={form.sex ?? ""} onChange={(e) => set("sex", e.target.value)}>
              <option value="">—</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Breed">
            <input className={inputCls} value={form.breed ?? ""} onChange={(e) => set("breed", e.target.value)} placeholder="Angus" />
          </Field>
          <Field label="Birth date">
            <input type="date" className={inputCls} value={form.birth_date ?? ""} onChange={(e) => set("birth_date", e.target.value)} />
          </Field>
          <Field label="Pasture">
            <input
              className={inputCls}
              value={form.pasture ?? ""}
              onChange={(e) => set("pasture", e.target.value)}
              placeholder="North River Pasture"
              list="pasture-options"
            />
            <datalist id="pasture-options">
              {pastures.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Herd group" className="sm:col-span-2">
            <select
              className={inputCls}
              value={form.herd_group_id ?? ""}
              onChange={(e) => set("herd_group_id", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— none —</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Disposition, bloodline, sale plan…" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
          <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 disabled:opacity-60">
            {saving ? "Saving…" : editing ? "Save changes" : "Add animal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add health event
// ---------------------------------------------------------------------------

const typeTone: Record<string, "green" | "amber" | "blue" | "red" | "stone"> = {
  vaccination: "green",
  treatment: "amber",
  inspection: "blue",
  injury: "red",
  other: "stone",
};

export function HealthEventFormModal({
  animal,
  onClose,
  onSaved,
}: {
  animal: Animal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<HealthEventInput>({
    animal_id: animal.id,
    event_date: today(),
    type: "vaccination",
    description: "",
    product: "",
    dosage: "",
    vet: "",
    withdrawal_days: null,
    next_due: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HealthEventInput>(k: K, v: HealthEventInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await addHealthEvent({ data: { ...form, next_due: form.next_due || null } });
    setSaving(false);
    if (res.ok) {
      onSaved();
    } else {
      setError(res.error);
    }
  };

  return (
    <Modal title="Log health event" sub={`${animal.name}${animal.tag_number ? ` · ${animal.tag_number}` : ""}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => set("type", e.target.value)}>
              {HEALTH_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Event date *">
            <input type="date" className={inputCls} value={form.event_date} onChange={(e) => set("event_date", e.target.value)} required />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className={inputCls} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="8-way Clostridium booster, pinkeye treatment…" />
          </Field>
          <Field label="Product">
            <input className={inputCls} value={form.product ?? ""} onChange={(e) => set("product", e.target.value)} placeholder="Covexin 8" />
          </Field>
          <Field label="Dosage">
            <input className={inputCls} value={form.dosage ?? ""} onChange={(e) => set("dosage", e.target.value)} placeholder="2 ml SQ" />
          </Field>
          <Field label="Vet">
            <input className={inputCls} value={form.vet ?? ""} onChange={(e) => set("vet", e.target.value)} placeholder="Dr. Whitfield" />
          </Field>
          <Field label="Withdrawal (days)">
            <input type="number" min={0} className={inputCls} value={form.withdrawal_days ?? ""} onChange={(e) => set("withdrawal_days", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Next due" className="sm:col-span-2">
            <input type="date" className={inputCls} value={form.next_due ?? ""} onChange={(e) => set("next_due", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
          <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 disabled:opacity-60">
            {saving ? "Saving…" : "Log event"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Animal detail — facts + full health history
// ---------------------------------------------------------------------------

export function AnimalDetailModal({
  animal,
  events,
  onClose,
  onEdit,
  onAddEvent,
}: {
  animal: Animal;
  events: HealthEvent[];
  onClose: () => void;
  onEdit: () => void;
  onAddEvent: () => void;
}) {
  return (
    <Modal
      title={animal.name}
      sub={animal.tag_number ? `Tag ${animal.tag_number}` : `Record #${animal.id}`}
      onClose={onClose}
      wide
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {speciesBadge(animal.species)}
        <Badge tone={statusTone[animal.status] ?? "stone"}>{animal.status[0].toUpperCase() + animal.status.slice(1)}</Badge>
        {animal.sex && <Badge tone="stone">{animal.sex[0].toUpperCase() + animal.sex.slice(1)}</Badge>}
        {animal.breed && <Badge tone="stone">{animal.breed}</Badge>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-3">
        <div><span className="text-stone-500">Birth date</span><p className="font-medium text-stone-800">{animal.birth_date ? `${animal.birth_date} (${ageLabel(animal.birth_date)})` : "—"}</p></div>
        <div><span className="text-stone-500">Herd group</span><p className="font-medium text-stone-800">{animal.herd_group_name ?? "—"}</p></div>
        <div><span className="text-stone-500">Pasture</span><p className="font-medium text-stone-800">{animal.pasture ?? "—"}</p></div>
        {animal.notes && (
          <div className="col-span-2 sm:col-span-3"><span className="text-stone-500">Notes</span><p className="text-stone-800">{animal.notes}</p></div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Health history</h4>
        <button onClick={onAddEvent} className="rounded-lg border border-green-700/40 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800 transition hover:bg-green-100">
          + Log event
        </button>
      </div>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
          No health events logged yet.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-stone-100">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-stone-50">
              <tr className="text-xs uppercase tracking-wide text-stone-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Product / dosage</th>
                <th className="px-3 py-2">Vet</th>
                <th className="px-3 py-2">Next due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-stone-700">{ev.event_date}</td>
                  <td className="px-3 py-2.5"><Badge tone={typeTone[ev.type] ?? "stone"}>{ev.type}</Badge></td>
                  <td className="px-3 py-2.5 text-stone-800">
                    {ev.description ?? "—"}
                    {ev.withdrawal_days != null && (
                      <span className="ml-2 text-xs text-amber-700">wd {ev.withdrawal_days}d</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{[ev.product, ev.dosage].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 text-stone-600">{ev.vet ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-stone-700">{ev.next_due ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2 border-t border-stone-100 pt-4">
        <button onClick={onClose} className="btn-outline !px-4 !py-2">Close</button>
        <button onClick={onEdit} className="btn-primary !px-4 !py-2">Edit animal</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function ageLabel(birthDate: string): string {
  const b = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 0) return "newborn";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months}mo`;
  return rem ? `${years}y ${rem}m` : `${years}y`;
}
