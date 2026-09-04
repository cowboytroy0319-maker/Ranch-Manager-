// ============================================================================
// Ranch Manager Pro — Expense mobile create flow (Quick Add / expenses route).
// Bottom-sheet form with full-width controls, numeric input modes, and a
// sticky labeled Save bar. Saves through the operation-scoped saveExpense
// server fn; the edit path is the same sheet pre-filled (used by /expenses).
// ============================================================================
import { useState } from "react";
import { LabeledField } from "~/components/ui";
import { SheetModal, StickyFooter, sheetInputCls } from "~/components/Sheet";
import { saveExpense, type ExpenseInput } from "~/server/expenses";
import { EXPENSE_CATEGORIES, CATEGORY_LABEL, type ExpenseRow } from "~/types/expenses";

const today = () => new Date().toISOString().slice(0, 10);

const EF = {
  done: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700",
  feed: "grid gap-4 sm:grid-cols-2",
  btns: "flex flex-col gap-2 sm:flex-row sm:justify-end",
  btn: "md:btn-outline",
};

export function ExpenseFormModal({
  editing,
  refs,
  onClose,
  onSaved,
}: {
  editing: ExpenseRow | null;
  refs: { groups: { id: number; name: string; species: string }[]; pastures: { id: number; name: string }[]; equipment: { id: number; name: string }[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ExpenseInput>({
    id: editing?.id,
    expense_date: editing?.expense_date ?? today(),
    category: editing?.category ?? "feed",
    amount_cents: editing?.amount_cents ?? 0,
    vendor: editing?.vendor ?? "",
    herd_group_id: editing?.herd_group_id ?? null,
    pasture_id: editing?.pasture_id ?? null,
    equipment_id: editing?.equipment_id ?? null,
    job: editing?.job ?? "",
    notes: editing?.notes ?? "",
  });
  const [amountDollars, setAmountDollars] = useState(
    editing ? (editing.amount_cents / 100).toFixed(2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(Number(amountDollars) * 100);
    if (!Number.isFinite(cents) || Number(amountDollars) <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveExpense({
      data: { ...form, id: form.id ?? undefined, amount_cents: cents },
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error);
  };

  return (
    <SheetModal
      title={editing ? "Edit expense" : "Add expense"}
      sub="Scoped to the herd, pasture, equipment, or job that spent it"
      onClose={onClose}
      footer={
        <StickyFooter>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="expense-form" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : editing ? "Save changes" : "Add expense"}
          </button>
        </StickyFooter>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        {error && <div className={EF.done}>{error}</div>}
        <div className={EF.feed}>
          <LabeledField label="Category *">
            <select className={sheetInputCls} value={form.category} onChange={(e) => set("category", e.target.value as ExpenseInput["category"])}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Date *">
            <input type="date" className={sheetInputCls} value={form.expense_date} onChange={(e) => set("expense_date", e.target.value)} required />
          </LabeledField>
          <LabeledField label="Amount ($) *">
            <input
              inputMode="decimal"
              type="number"
              min={0}
              step={0.01}
              className={sheetInputCls}
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              placeholder="125.00"
              required
            />
          </LabeledField>
          <LabeledField label="Vendor">
            <input className={sheetInputCls} value={form.vendor ?? ""} onChange={(e) => set("vendor", e.target.value)} placeholder="Chappell Feed & Seed" />
          </LabeledField>
          <LabeledField label="Herd / group">
            <select className={sheetInputCls} value={form.herd_group_id ?? ""} onChange={(e) => set("herd_group_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— none —</option>
              {refs.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}{g.species ? ` (${g.species})` : ""}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Pasture">
            <select className={sheetInputCls} value={form.pasture_id ?? ""} onChange={(e) => set("pasture_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— none —</option>
              {refs.pastures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Equipment / vehicle">
            <select className={sheetInputCls} value={form.equipment_id ?? ""} onChange={(e) => set("equipment_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— none —</option>
              {refs.equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Job / activity">
            <input className={sheetInputCls} value={form.job ?? ""} onChange={(e) => set("job", e.target.value)} placeholder="Feeding, fence build…" />
          </LabeledField>
          <LabeledField label="Notes" className="sm:col-span-2">
            <textarea className={sheetInputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Receipt detail, delivery notes…" />
          </LabeledField>
        </div>
      </form>
    </SheetModal>
  );
}