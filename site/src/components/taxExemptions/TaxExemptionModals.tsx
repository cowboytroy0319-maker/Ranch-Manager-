// ============================================================================
// Ranch Manager Pro — Tax & ag-exemption add/edit modal. Plain controlled form;
// Tailwind stone/green language, matching the employees/livestock module forms.
// This is RECORD-KEEPING — a small disclaimer is shown; it is not tax advice.
// Jurisdiction is free text (state/province) and identifier numbers are typed
// as text, keeping the module region/locale-agnostic.
// ============================================================================
import { useState } from "react";
import { Card } from "~/components/ui";
import { saveTaxExemption } from "~/server/taxExemptions";
import { IDENTIFIER_TYPE_SUGGESTIONS, type TaxExemptionInput, type TaxExemptionRow } from "~/types/taxExemptions";

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

export function TaxExemptionFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: TaxExemptionRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TaxExemptionInput>({
    id: editing?.id,
    identifier_type: editing?.identifier_type ?? "",
    identifier_number: editing?.identifier_number ?? "",
    jurisdiction: editing?.jurisdiction ?? "",
    entity: editing?.entity ?? "",
    expires_on: editing?.expires_on ?? "",
    contact: editing?.contact ?? "",
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TaxExemptionInput>(k: K, v: TaxExemptionInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveTaxExemption({ data: { ...form, id: form.id ?? undefined } });
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
              <h3 className="text-lg font-bold text-stone-900">{editing ? `Edit ${editing.identifier_type}` : "Add tax ID / exemption"}</h3>
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
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              Record-keeping only — this registry does not provide tax advice.
            </div>
            {error && <ErrorNote error={error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Identifier type *">
                <input
                  className={inputCls}
                  list="tax-id-types"
                  value={form.identifier_type}
                  onChange={(e) => set("identifier_type", e.target.value)}
                  placeholder="Sales-tax ag exemption, EIN…"
                  required
                />
                <datalist id="tax-id-types">
                  {IDENTIFIER_TYPE_SUGGESTIONS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field label="Identifier number">
                <input
                  className={inputCls}
                  value={form.identifier_number ?? ""}
                  onChange={(e) => set("identifier_number", e.target.value)}
                  placeholder="AG-EX-71042"
                />
              </Field>
              <Field label="Jurisdiction (state/province) *">
                <input
                  className={inputCls}
                  value={form.jurisdiction}
                  onChange={(e) => set("jurisdiction", e.target.value)}
                  placeholder="Texas, US federal, Alberta…"
                  required
                />
              </Field>
              <Field label="Applies to (entity / operation)">
                <input
                  className={inputCls}
                  value={form.entity ?? ""}
                  onChange={(e) => set("entity", e.target.value)}
                  placeholder="T Bar T Ranch"
                />
              </Field>
              <Field label="Expiry date (blank = never expires)">
                <input
                  type="date"
                  className={inputCls}
                  value={form.expires_on ?? ""}
                  onChange={(e) => set("expires_on", e.target.value)}
                />
              </Field>
              <Field label="Contact / issuing office">
                <input
                  className={inputCls}
                  value={form.contact ?? ""}
                  onChange={(e) => set("contact", e.target.value)}
                  placeholder="County appraisal district"
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className={inputCls}
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="What this covers, renewal steps, deadlines…"
              />
            </Field>
            <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
              <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save changes" : "Add record"}
              </button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
