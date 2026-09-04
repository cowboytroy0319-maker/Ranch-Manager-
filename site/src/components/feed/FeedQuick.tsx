// ============================================================================
// Ranch Manager Pro — Feed mobile create flows (Quick Add targets).
// Two bottom sheets: AddHayFeedSheet (add a hay stack or feed item — the
// "add hay/feed" Quick Add action) and LogUsageSheet (the "log hay/feed use"
// Quick Add action). Full-width controls, decimal/numeric input modes, sticky
// labeled Save bars. Both save through the existing operation-scoped server
// fns (saveHay / saveFeedItem / logUsage).
// ============================================================================
import { useState } from "react";
import { LabeledField } from "~/components/ui";
import { SheetModal, StickyFooter, sheetInputCls } from "~/components/Sheet";
import { logUsage, saveFeedItem, saveHay, type FeedItemInput, type HayInput } from "~/server/feed";
import {
  FEED_CATEGORIES,
  FEED_UNITS,
  HAY_TYPES,
  HAY_UNITS,
  type HayItem,
  type FeedItem,
  type HerdGroupRef,
} from "~/types/feed";

const today = () => new Date().toISOString().slice(0, 10);
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const errCls = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
const hayLabel = (h: HayItem) => `${cap(h.feed_type)}${h.cutting ? `, ${h.cutting} cutting` : ""}${h.field_or_source ? ` — ${h.field_or_source}` : ""}`;

// ---------------------------------------------------------------------------
// Add hay / feed (Quick Add "Add hay/feed"): a mode toggle + the right form.
// ---------------------------------------------------------------------------
export function AddHayFeedSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"hay" | "feed">("hay");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hay state
  const [hay, setHay] = useState<HayInput>({
    feed_type: "grass",
    cutting: "",
    field_or_source: "",
    storage_location: "",
    quantity: 0,
    unit: "bales",
    bale_weight_lbs: null,
    date_acquired: today(),
    low_stock_threshold: 0,
    notes: "",
  });
  // Feed state
  const [feed, setFeed] = useState<FeedItemInput>({
    name: "",
    category: "grain",
    quantity: 0,
    unit: "lbs",
    supplier: "",
    unit_cost_cents: null,
    low_stock_threshold: 0,
    notes: "",
  });
  const [costDollars, setCostDollars] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let res: { ok: boolean; error?: string };
    if (mode === "hay") {
      res = await saveHay({ data: { ...hay } });
    } else {
      const cents = costDollars.trim() === "" ? null : Math.round(Number(costDollars) * 100);
      res = await saveFeedItem({
        data: { ...feed, unit_cost_cents: cents != null && Number.isFinite(cents) ? cents : null },
      });
    }
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error ?? "Something went wrong.");
  };

  return (
    <SheetModal
      title="Add hay / feed"
      sub="New stack or item in the live inventory"
      onClose={onClose}
      footer={
        <StickyFooter>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto">
            Cancel
          </button>
          <button
            type="submit"
            form="add-hay-feed-form"
            disabled={saving || (mode === "feed" && !feed.name.trim())}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Saving…" : mode === "hay" ? "Add stack" : "Add item"}
          </button>
        </StickyFooter>
      }
    >
      <form id="add-hay-feed-form" onSubmit={submit} className="space-y-4">
        {error && <div className={errCls}>{error}</div>}
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-stone-200 p-1">
          {(["hay", "feed"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === m ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {m === "hay" ? "🌾 Hay stack" : "🥣 Feed item"}
            </button>
          ))}
        </div>

        {mode === "hay" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Hay type">
              <select className={sheetInputCls} value={hay.feed_type} onChange={(e) => setHay((f) => ({ ...f, feed_type: e.target.value }))}>
                {HAY_TYPES.map((t) => (
                  <option key={t} value={t}>{cap(t)}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label="Cutting">
              <input className={sheetInputCls} value={hay.cutting ?? ""} onChange={(e) => setHay((f) => ({ ...f, cutting: e.target.value }))} placeholder="2nd" />
            </LabeledField>
            <LabeledField label="Field / source" className="sm:col-span-2">
              <input className={sheetInputCls} value={hay.field_or_source ?? ""} onChange={(e) => setHay((f) => ({ ...f, field_or_source: e.target.value }))} placeholder="River Field / bought" />
            </LabeledField>
            <LabeledField label="Storage location" className="sm:col-span-2">
              <input className={sheetInputCls} value={hay.storage_location ?? ""} onChange={(e) => setHay((f) => ({ ...f, storage_location: e.target.value }))} placeholder="Main barn — south row" />
            </LabeledField>
            <LabeledField label="Unit">
              <select className={sheetInputCls} value={hay.unit} onChange={(e) => setHay((f) => ({ ...f, unit: e.target.value }))}>
                {HAY_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label={`Quantity on hand (${hay.unit}) *`}>
              <input
                inputMode={hay.unit === "tons" ? "decimal" : "numeric"}
                type="number" min={0} step={hay.unit === "tons" ? 0.1 : 1}
                className={sheetInputCls}
                value={hay.quantity || ""}
                onChange={(e) => setHay((f) => ({ ...f, quantity: e.target.value === "" ? 0 : Number(e.target.value) }))}
                required
              />
            </LabeledField>
            {hay.unit === "bales" && (
              <LabeledField label="Avg bale weight (lbs)">
                <input
                  inputMode="numeric"
                  type="number" min={1} step={1}
                  className={sheetInputCls}
                  value={hay.bale_weight_lbs ?? ""}
                  onChange={(e) => setHay((f) => ({ ...f, bale_weight_lbs: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="62"
                />
              </LabeledField>
            )}
            <LabeledField label="Low-stock alert at">
              <input
                inputMode={hay.unit === "tons" ? "decimal" : "numeric"}
                type="number" min={0} step={hay.unit === "tons" ? 0.1 : 1}
                className={sheetInputCls}
                value={hay.low_stock_threshold || ""}
                onChange={(e) => setHay((f) => ({ ...f, low_stock_threshold: e.target.value === "" ? 0 : Number(e.target.value) }))}
                placeholder={hay.unit === "tons" ? "6" : "150"}
              />
            </LabeledField>
            <LabeledField label="Date acquired">
              <input type="date" className={sheetInputCls} value={hay.date_acquired ?? ""} onChange={(e) => setHay((f) => ({ ...f, date_acquired: e.target.value }))} />
            </LabeledField>
            <LabeledField label="Notes" className="sm:col-span-2">
              <textarea className={sheetInputCls} rows={2} value={hay.notes ?? ""} onChange={(e) => setHay((f) => ({ ...f, notes: e.target.value }))} placeholder="Quality, rain damage, who it's for…" />
            </LabeledField>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Name *" className="sm:col-span-2">
              <input className={sheetInputCls} value={feed.name} onChange={(e) => setFeed((f) => ({ ...f, name: e.target.value }))} placeholder="20% range cubes" required />
            </LabeledField>
            <LabeledField label="Category">
              <select className={sheetInputCls} value={feed.category} onChange={(e) => setFeed((f) => ({ ...f, category: e.target.value }))}>
                {FEED_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{cap(c)}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label="Unit">
              <select className={sheetInputCls} value={feed.unit} onChange={(e) => setFeed((f) => ({ ...f, unit: e.target.value }))}>
                {FEED_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label={`Quantity on hand (${feed.unit}) *`}>
              <input
                inputMode={feed.unit === "tons" ? "decimal" : "numeric"}
                type="number" min={0} step={feed.unit === "tons" ? 0.1 : 1}
                className={sheetInputCls}
                value={feed.quantity || ""}
                onChange={(e) => setFeed((f) => ({ ...f, quantity: e.target.value === "" ? 0 : Number(e.target.value) }))}
                required
              />
            </LabeledField>
            <LabeledField label="Low-stock alert at">
              <input
                inputMode={feed.unit === "tons" ? "decimal" : "numeric"}
                type="number" min={0} step={feed.unit === "tons" ? 0.1 : 1}
                className={sheetInputCls}
                value={feed.low_stock_threshold || ""}
                onChange={(e) => setFeed((f) => ({ ...f, low_stock_threshold: e.target.value === "" ? 0 : Number(e.target.value) }))}
                placeholder="200"
              />
            </LabeledField>
            <LabeledField label="Supplier">
              <input className={sheetInputCls} value={feed.supplier ?? ""} onChange={(e) => setFeed((f) => ({ ...f, supplier: e.target.value }))} placeholder="Chappell Feed & Seed" />
            </LabeledField>
            <LabeledField label="Cost per unit ($)">
              <input
                inputMode="decimal"
                type="number" min={0} step={0.01}
                className={sheetInputCls}
                value={costDollars}
                onChange={(e) => setCostDollars(e.target.value)}
                placeholder={feed.unit === "bags" ? "18.50" : "0.19"}
              />
            </LabeledField>
            <LabeledField label="Notes" className="sm:col-span-2">
              <textarea className={sheetInputCls} rows={2} value={feed.notes ?? ""} onChange={(e) => setFeed((f) => ({ ...f, notes: e.target.value }))} placeholder="Ration notes, delivery cadence…" />
            </LabeledField>
          </div>
        )}
      </form>
    </SheetModal>
  );
}

// ---------------------------------------------------------------------------
// Log hay/feed use (Quick Add "Log hay/feed use")
// ---------------------------------------------------------------------------
export function LogUsageSheet({
  hay,
  feed,
  groups,
  pastures,
  onClose,
  onSaved,
}: {
  hay: HayItem[];
  feed: FeedItem[];
  groups: HerdGroupRef[];
  pastures: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"hay" | "feed">(hay.length ? "hay" : feed.length ? "feed" : "hay");
  const [itemId, setItemId] = useState<string>(
    hay.length ? String(hay[0].id) : feed.length ? String(feed[0].id) : ""
  );
  const [quantity, setQuantity] = useState<number | "">("");
  const [logDate, setLogDate] = useState(today());
  const [groupId, setGroupId] = useState<number | null>(null);
  const [pasture, setPasture] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = kind === "hay" ? hay : feed;
  const selected = all.find((x) => x.id === Number(itemId));
  const unit = selected?.unit ?? "";
  const onHand = selected?.quantity ?? null;
  const itemsEmpty = hay.length === 0 && feed.length === 0;

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
        item_id: selected.id,
        log_date: logDate,
        quantity: Number(quantity),
        herd_group_id: groupId,
        pasture: pasture,
        notes: notes,
      },
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.error ?? "Something went wrong.");
  };

  return (
    <SheetModal
      title="Log hay / feed use"
      sub="Takes it off the on-hand count"
      onClose={onClose}
      footer={
        <StickyFooter>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto">
            Cancel
          </button>
          <button
            type="submit"
            form="log-usage-form"
            disabled={saving || itemsEmpty || !selected}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Logging…" : "Log use"}
          </button>
        </StickyFooter>
      }
    >
      <form id="log-usage-form" onSubmit={submit} className="space-y-4">
        {error && <div className={errCls}>{error}</div>}
        {itemsEmpty ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing in the inventory yet — add a hay stack or feed item first.
          </p>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-stone-200 p-1">
              {(["hay", "feed"] as const).filter((k) => (k === "hay" ? hay.length : feed.length)).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setItemId(k === "hay" ? String(hay[0]?.id ?? "") : String(feed[0]?.id ?? "")); setQuantity(""); }}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${kind === k ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}
                >
                  {k === "hay" ? "🌾 Hay" : "🥣 Feed"}
                </button>
              ))}
            </div>
            <LabeledField label="Item *">
              <select className={sheetInputCls} value={itemId} onChange={(e) => { setItemId(e.target.value); setQuantity(""); }}>
                {all.map((x) => (
                  <option key={x.id} value={x.id}>
                    {kind === "hay" ? hayLabel(x as HayItem) : (x as FeedItem).name} ({x.quantity} {x.unit})
                  </option>
                ))}
              </select>
            </LabeledField>
            <div className="grid gap-4 sm:grid-cols-2">
              <LabeledField label={`Quantity used (${unit}) *`}>
                <input
                  inputMode={unit === "tons" ? "decimal" : "numeric"}
                  type="number" min={0} step={unit === "tons" ? 0.25 : 1}
                  className={sheetInputCls}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                />
                {onHand != null && <p className="mt-1 text-xs text-stone-500">{onHand} {unit} on hand</p>}
              </LabeledField>
              <LabeledField label="Date *">
                <input type="date" className={sheetInputCls} value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
              </LabeledField>
              <LabeledField label="Herd group">
                <select className={sheetInputCls} value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— none —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </LabeledField>
              <LabeledField label="Pasture">
                <input
                  className={sheetInputCls}
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
              </LabeledField>
              <LabeledField label="Notes" className="sm:col-span-2">
                <input className={sheetInputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fed at the north feeder…" />
              </LabeledField>
            </div>
          </>
        )}
      </form>
    </SheetModal>
  );
}