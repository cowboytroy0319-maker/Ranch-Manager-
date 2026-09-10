// ============================================================================
// Ranch Manager Pro — Hay & Feed modals (hay form, feed form, log-usage form,
// restock form). Plain controlled forms; Tailwind stone/green language — same
// patterns as the livestock module's modals.
//
// Restock is a separate, dedicated action from Edit: it appends quantity and
// (optionally) records a linked expense through the idempotent restockItem
// server fn. The client_request_id is generated ONCE per form-open (in a
// useState initializer) and re-sent unchanged on every retry so double-taps
// never double-apply inventory or create a second expense.
// ============================================================================
import { useState } from "react";
import { Card } from "~/components/ui";
import { logUsage, restockItem, saveFeedItem, saveHay, type FeedItemInput, type HayInput } from "~/server/feed";
import {
  FEED_CATEGORIES,
  FEED_UNITS,
  HAY_TYPES,
  HAY_UNITS,
  fmtQty,
  type FeedItem,
  type HayItem,
  type HerdGroupRef,
} from "~/types/feed";
import { buildRestockSubmit, newClientRequestId, restockResultMessage } from "./restockUI";

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
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/50 sm:items-center sm:p-6" onClick={onClose}>
      <Card className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-xl sm:max-h-[90vh] sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="shrink-0 border-b border-stone-100 px-4 py-4 sm:px-6" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-200 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-stone-900">{title}</h3>
              {sub && <p className="text-sm text-stone-500">{sub}</p>}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
        {footer && (
          <div
            className="shrink-0 border-t border-stone-100 bg-white px-4 py-3 sm:px-6"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {footer}
          </div>
        )}
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

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Add / edit hay stack
// ---------------------------------------------------------------------------

export function HayFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: HayItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<HayInput>({
    id: editing?.id,
    feed_type: editing?.feed_type ?? "grass",
    cutting: editing?.cutting ?? "",
    field_or_source: editing?.field_or_source ?? "",
    storage_location: editing?.storage_location ?? "",
    quantity: editing?.quantity ?? 0,
    unit: editing?.unit ?? "bales",
    bale_weight_lbs: editing?.bale_weight_lbs ?? null,
    date_acquired: editing?.date_acquired ?? "",
    low_stock_threshold: editing?.low_stock_threshold ?? 0,
    notes: editing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HayInput>(k: K, v: HayInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveHay({ data: { ...form, id: form.id ?? undefined } });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error);
  };

  return (
    <Modal
      title={editing ? "Edit hay stack" : "Add hay stack"}
      sub={editing ? `Stack #${editing.id} — ${fmtQty(editing.quantity, editing.unit)} on hand` : "New stack in the live database"}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="hay-form" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : editing ? "Save changes" : "Add stack"}
          </button>
        </div>
      }
    >
      <form id="hay-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hay type">
            <select className={inputCls} value={form.feed_type} onChange={(e) => set("feed_type", e.target.value)}>
              {HAY_TYPES.map((t) => (
                <option key={t} value={t}>{cap(t)}</option>
              ))}
            </select>
          </Field>
          <Field label="Cutting">
            <input className={inputCls} value={form.cutting ?? ""} onChange={(e) => set("cutting", e.target.value)} placeholder="2nd" />
          </Field>
          <Field label="Field / source" className="sm:col-span-2">
            <input className={inputCls} value={form.field_or_source ?? ""} onChange={(e) => set("field_or_source", e.target.value)} placeholder="River Field / bought — Mule Shoe Dairy" />
          </Field>
          <Field label="Storage location" className="sm:col-span-2">
            <input className={inputCls} value={form.storage_location ?? ""} onChange={(e) => set("storage_location", e.target.value)} placeholder="Main barn — south row" />
          </Field>
          <Field label="Unit">
            <select className={inputCls} value={form.unit} onChange={(e) => set("unit", e.target.value)}>
              {HAY_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity on hand (${form.unit}) *`}>
            <input
              type="number" min={0} step={form.unit === "tons" ? 0.1 : 1}
              inputMode={form.unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value === "" ? 0 : Number(e.target.value))}
              required
            />
          </Field>
          {form.unit === "bales" && (
            <Field label="Avg bale weight (lbs)">
              <input
                type="number" min={1} step={1}
                inputMode="numeric"
                className={inputCls}
                value={form.bale_weight_lbs ?? ""}
                onChange={(e) => set("bale_weight_lbs", e.target.value ? Number(e.target.value) : null)}
                placeholder="62"
              />
            </Field>
          )}
          <Field label="Date acquired">
            <input type="date" className={inputCls} value={form.date_acquired ?? ""} onChange={(e) => set("date_acquired", e.target.value)} />
          </Field>
          <Field label="Low-stock alert at">
            <input
              type="number" min={0} step={form.unit === "tons" ? 0.1 : 1}
              inputMode={form.unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={form.low_stock_threshold}
              onChange={(e) => set("low_stock_threshold", e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder={form.unit === "tons" ? "6" : "150"}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Quality, rain damage, who it's for…" />
        </Field>
      </form>
    </Modal>
  );
}
// ---------------------------------------------------------------------------
// Add / edit feed item
// ---------------------------------------------------------------------------

export function FeedFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: FeedItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FeedItemInput>({
    id: editing?.id,
    name: editing?.name ?? "",
    category: editing?.category ?? "grain",
    quantity: editing?.quantity ?? 0,
    unit: editing?.unit ?? "lbs",
    supplier: editing?.supplier ?? "",
    unit_cost_cents: editing?.unit_cost_cents ?? null,
    low_stock_threshold: editing?.low_stock_threshold ?? 0,
    notes: editing?.notes ?? "",
  });
  const [costDollars, setCostDollars] = useState(
    editing?.unit_cost_cents != null ? (editing.unit_cost_cents / 100).toFixed(2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FeedItemInput>(k: K, v: FeedItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const cents = costDollars.trim() === "" ? null : Math.round(Number(costDollars) * 100);
    const res = await saveFeedItem({
      data: { ...form, id: form.id ?? undefined, unit_cost_cents: cents != null && Number.isFinite(cents) ? cents : null },
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error);
  };

  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add feed item"}
      sub={editing ? `Item #${editing.id} — ${fmtQty(editing.quantity, editing.unit)} on hand` : "New item in the live database"}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="feed-form" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
          </button>
        </div>
      }
    >
      <form id="feed-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name *" className="sm:col-span-2">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="20% range cubes" required />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
              {FEED_CATEGORIES.map((c) => (
                <option key={c} value={c}>{cap(c)}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <select className={inputCls} value={form.unit} onChange={(e) => set("unit", e.target.value)}>
              {FEED_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity on hand (${form.unit}) *`}>
            <input
              type="number" min={0} step={form.unit === "tons" ? 0.1 : 1}
              inputMode={form.unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value === "" ? 0 : Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Low-stock alert at">
            <input
              type="number" min={0} step={form.unit === "tons" ? 0.1 : 1}
              inputMode={form.unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={form.low_stock_threshold}
              onChange={(e) => set("low_stock_threshold", e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder="200"
            />
          </Field>
          <Field label="Supplier">
            <input className={inputCls} value={form.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} placeholder="Chappell Feed & Seed" />
          </Field>
          <Field label="Cost per unit ($)">
            <input
              type="number" min={0} step={0.01}
              inputMode="decimal"
              className={inputCls}
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder={form.unit === "bags" ? "18.50" : "0.19"}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Ration notes, delivery cadence…" />
        </Field>
      </form>
    </Modal>
  );
}
// ---------------------------------------------------------------------------
// Log usage — inserts a usage entry and decrements on-hand quantity
// ---------------------------------------------------------------------------

export function LogUsageModal({
  hay,
  feed,
  groups,
  pastures,
  preselect,
  onClose,
  onSaved,
}: {
  hay: HayItem[];
  feed: FeedItem[];
  groups: HerdGroupRef[];
  pastures: string[];
  preselect: { kind: "hay" | "feed"; id: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itemKey, setItemKey] = useState<string>(
    preselect ? `${preselect.kind}:${preselect.id}` : hay.length ? `hay:${hay[0].id}` : feed.length ? `feed:${feed[0].id}` : ""
  );
  const [quantity, setQuantity] = useState<number | "">("");
  const [logDate, setLogDate] = useState(today());
  const [groupId, setGroupId] = useState<number | null>(null);
  const [pasture, setPasture] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kindStr, idStr] = itemKey.split(":");
  const kind = kindStr === "feed" ? "feed" : "hay";
  const itemId = Number(idStr);
  const all = kind === "hay"
    ? hay.map((h) => ({ kind: "hay" as const, item: h }))
    : feed.map((f) => ({ kind: "feed" as const, item: f }));
  const selected = all.find((x) => x.item.id === itemId);
  const unit = selected?.item.unit ?? "";
  const onHand = selected ? selected.item.quantity : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || quantity === "" || Number(quantity) <= 0) {
      setError("Pick an item and a quantity greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await logUsage({
      data: {
        item_kind: kind,
        item_id: itemId,
        log_date: logDate,
        quantity: Number(quantity),
        herd_group_id: groupId,
        pasture: pasture,
        notes: notes,
      },
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error);
  };

  return (
    <Modal title="Log feed / hay use" sub="Adds a usage entry and takes it off the on-hand count" onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="log-usage-form" disabled={saving || !selected} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Logging…" : "Log use"}
          </button>
        </div>
      }
    >
      <form id="log-usage-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <Field label="Item *">
          <select className={inputCls} value={itemKey} onChange={(e) => { setItemKey(e.target.value); setQuantity(""); }}>
            <optgroup label="Hay">
              {hay.map((h) => (
                <option key={`hay-${h.id}`} value={`hay:${h.id}`}>
                  Hay — {hayLabel(h)} ({fmtQty(h.quantity, h.unit)})
                </option>
              ))}
            </optgroup>
            <optgroup label="Feed">
              {feed.map((f) => (
                <option key={`feed-${f.id}`} value={`feed:${f.id}`}>
                  Feed — {f.name} ({fmtQty(f.quantity, f.unit)})
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Quantity used (${unit}) *`}>
            <input
              type="number" min={0} step={unit === "tons" ? 0.25 : 1}
              inputMode={unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
              required
            />
            {onHand != null && (
              <p className="mt-1 text-xs text-stone-500">{fmtQty(onHand, unit)} on hand</p>
            )}
          </Field>
          <Field label="Date *">
            <input type="date" className={inputCls} value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
          </Field>
          <Field label="Herd group">
            <select
              className={inputCls}
              value={groupId ?? ""}
              onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— none —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Pasture">
            <input
              className={inputCls}
              value={pasture}
              onChange={(e) => setPasture(e.target.value)}
              placeholder="North River Pasture"
              list="usage-pasture-options"
            />
            <datalist id="usage-pasture-options">
              {pastures.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fed at the north feeder…" />
        </Field>
      </form>
    </Modal>
  );
}
export function hayLabel(h: HayItem): string {
  const source = h.field_or_source ? ` — ${h.field_or_source}` : "";
  return `${cap(h.feed_type)}${h.cutting ? `, ${h.cutting} cutting` : ""}${source}`;
}

// ---------------------------------------------------------------------------
// Restock — a DEDICATED action (never the edit form): appends quantity to an
// existing hay/feed item and optionally records a linked hay_feed expense.
// Idempotent: client_request_id is generated once per form-open and reused on
// every retry/double-tap; the server dedupes on it.
// ---------------------------------------------------------------------------

export function RestockModal({
  hay,
  feed,
  preselect,
  onClose,
  onSaved,
}: {
  hay: HayItem[];
  feed: FeedItem[];
  preselect: { kind: "hay" | "feed"; id: number } | null;
  onClose: () => void;
  /** Called with the exact user-facing outcome message. */
  onSaved: (message: string) => void;
}) {
  const [itemKind, setItemKind] = useState<"hay" | "feed">(preselect?.kind ?? "hay");
  const items = itemKind === "hay" ? hay : feed;
  const [itemId, setItemId] = useState<number | null>(preselect?.id ?? items[0]?.id ?? null);
  const [quantity, setQuantity] = useState<number | "">("");
  const [restockDate, setRestockDate] = useState(today());
  const [costDollars, setCostDollars] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ONE idempotency key per form-open. Never regenerated on retry.
  const [clientRequestId] = useState(() => newClientRequestId());

  const selected = items.find((x) => x.id === itemId) ?? null;
  const unit = selected?.unit ?? "";

  const switchKind = (kind: "hay" | "feed") => {
    setItemKind(kind);
    const next = kind === "hay" ? hay : feed;
    setItemId(next[0]?.id ?? null);
    setQuantity("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || quantity === "" || Number(quantity) <= 0) {
      setError("Pick an item and a quantity greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    const cents =
      costDollars.trim() === "" ? null : Math.round(Number(costDollars) * 100);
    // Same clientRequestId on EVERY attempt (first send or retry).
    const payload = buildRestockSubmit(
      {
        item_kind: itemKind,
        item_id: selected.id,
        quantity: Number(quantity),
        unit: selected.unit,
        restock_date: restockDate,
        total_cost_cents: cents != null && Number.isFinite(cents) && cents > 0 ? cents : null,
        vendor: vendor.trim() ? vendor.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      },
      clientRequestId
    );
    const res = await restockItem({ data: payload });
    if (res.ok) {
      onSaved(restockResultMessage(res).text);
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title="Restock hay / feed"
      sub="Adds quantity on hand — with a cost, it also records the linked expense"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5">
            Cancel
          </button>
          <button type="submit" form="restock-form" disabled={saving || !selected} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto sm:px-5">
            {saving ? "Saving…" : "Save restock"}
          </button>
        </div>
      }
    >
      <form id="restock-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <Field label="Item type">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Item type">
            {(["hay", "feed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                aria-pressed={itemKind === k}
                className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${itemKind === k ? "border-green-700 bg-green-800 text-white" : "border-stone-300 bg-white text-stone-700"}`}
              >
                {k === "hay" ? "Hay" : "Feed"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Item *">
          <select className={inputCls} value={itemId ?? ""} onChange={(e) => { setItemId(e.target.value ? Number(e.target.value) : null); setQuantity(""); }}>
            <option value="">— pick an item —</option>
            {items.map((x) => (
              <option key={x.id} value={x.id}>
                {(itemKind === "hay" ? hayLabel(x as HayItem) : (x as FeedItem).name)} — {fmtQty(x.quantity, x.unit)} on hand
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Quantity added${unit ? ` (${unit})` : ""} *`}>
            <input
              type="number" min={0} step={unit === "tons" ? 0.1 : 1}
              inputMode={unit === "tons" ? "decimal" : "numeric"}
              className={inputCls}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
              required
            />
            {selected && <p className="mt-1 text-xs text-stone-500">{fmtQty(selected.quantity, selected.unit)} on hand now · counted in {unit || "—"}</p>}
          </Field>
          <Field label="Restock date *">
            <input type="date" className={inputCls} value={restockDate} onChange={(e) => setRestockDate(e.target.value)} required />
          </Field>
          <Field label="Total cost ($)">
            <input
              type="number" min={0} step={0.01}
              inputMode="decimal"
              className={inputCls}
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-stone-500">Optional — with a cost, a Hay &amp; feed expense is recorded and linked to this restock.</p>
          </Field>
          <Field label="Vendor">
            <input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Mule Shoe Dairy…" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery, quality, stack location…" />
        </Field>
      </form>
    </Modal>
  );
}
