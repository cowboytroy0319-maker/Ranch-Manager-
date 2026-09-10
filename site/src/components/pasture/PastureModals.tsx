// ============================================================================
// Ranch Manager Pro — Pasture modals: add/edit paddocks, the pasture DETAIL
// view (tap a pasture row), record-activity form, group-move form, and quick
// condition/water updates.
//
// Movement is explicitly GROUP-based: the app's tracked model is
// pasture_assignments keyed by herd_group_id (animals carry free-text pasture
// names, not a pasture FK). Every label says "group" — nothing implies
// animal-by-animal sync. Server rules (no self-move, no cross-operation ids,
// no negative head count) surface their own safe messages here.
// ============================================================================
import { useState } from "react";
import {
  savePasture,
  savePastureActivity,
  updatePastureActivity,
  deletePastureActivity,
  moveLivestock,
  PASTURE_ACTIVITY_DUPLICATE_MESSAGE,
  type PastureInput,
} from "~/server/pasture";
import { newClientRequestId } from "~/components/feed/restockUI";
import { useDraftPersistence, draftKey } from "~/components/drafts";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABEL,
  PASTURE_CONDITIONS,
  WATER_STATUSES,
  type Pasture,
  type PastureActivity,
  type PastureData,
  type Species,
} from "~/types/pasture";
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
// ---------------------------------------------------------------------------
// Shared bits for the detail view + its action forms
// ---------------------------------------------------------------------------
const todayStr = () => new Date().toISOString().slice(0, 10);
const money = (cents: number | null) =>
  cents == null
    ? "—"
    : "\$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const capFirst = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

const speciesEmoji: Partial<Record<Species, string>> = { cattle: "🐄", horse: "🐎", goat: "🐐", sheep: "🐑" };

const actionBtnCls =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-green-700 hover:text-green-800";

// ---------------------------------------------------------------------------
// Pasture DETAIL view — the tap-a-row screen. Facts, groups on pasture with
// turnout dates and days in pasture, activity timeline, movement history, and
// the four mobile actions. Factual records only — no forage/carrying-capacity
// predictions.
// ---------------------------------------------------------------------------

export function PastureDetailModal({
  pasture,
  data,
  onClose,
  onAction,
  onEditActivity,
  onMessage,
}: {
  pasture: Pasture;
  data: PastureData;
  onClose: () => void;
  /** Opens one of the detail's action forms (still inside the route). */
  onAction: (a: { kind: "activity" | "move" | "condition" | "water"; pasture: Pasture }) => void;
  /** Opens the activity form in EDIT mode for this activity. */
  onEditActivity: (a: PastureActivity) => void;
  /** Surfaces an outcome message (flash) — used after a delete. */
  onMessage: (message: string) => void;
}) {
  const activeAssignments = data.assignments.filter((a) => a.pasture_id === pasture.id && !a.ended_at);
  const activities = data.activities.filter((a) => a.pasture_id === pasture.id);
  const movements = data.movements.filter((m) => m.to_pasture_id === pasture.id || m.from_pasture_id === pasture.id);
  const pastureName = (id: number | null) => (id == null ? null : data.pastures.find((p) => p.id === id)?.name ?? null);
  const today = todayStr();
  // Delete confirmation state — the delete removes the activity AND its
  // linked expense together (server rule), so the ask says exactly that.
  const [deleting, setDeleting] = useState<PastureActivity | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    setDeleteError(null);
    const res = await deletePastureActivity({ data: deleting.id });
    setDeletingBusy(false);
    if (res.ok) {
      const removed = res.linked_expense_removed;
      setDeleting(null);
      onMessage(removed ? "Activity deleted and its linked expense removed." : "Activity deleted.");
    } else {
      setDeleteError(res.error);
    }
  };

  return (
    <>
    <Modal
      title={`🌾 ${pasture.name}`}
      sub={[pasture.pasture_type, pasture.location].filter(Boolean).join(" · ") || "Pasture detail"}
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        {/* Facts — status / condition / water / acres / capacity */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: "Status", value: capFirst(pasture.status) },
            { label: "Condition", value: capFirst(pasture.condition) },
            { label: "Water", value: capFirst(pasture.water_status) },
            { label: "Acres", value: pasture.size_acres != null ? pasture.size_acres.toLocaleString() : "—" },
            { label: "Capacity (head)", value: pasture.capacity_heads != null ? String(pasture.capacity_heads) : "—" },
          ].map((f) => (
            <div key={f.label} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{f.label}</p>
              <p className="text-sm font-bold text-stone-900">{f.value}</p>
            </div>
          ))}
        </div>

        {/* Groups currently on this pasture — the group-based model, honestly
            labeled. Head count shows only when a move record carried it. */}
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-stone-800">Groups on pasture</h4>
          {activeAssignments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-500">
              No group assigned right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeAssignments.map((a) => {
                const lastMoveIn = movements.find((m) => m.to_pasture_id === pasture.id && m.herd_group_id === a.herd_group_id);
                const turnout = a.assigned_at;
                return (
                  <li key={a.id} className="rounded-xl border border-stone-100 px-3 py-2.5">
                    <p className="text-sm font-semibold text-stone-900">
                      {a.species ? `${speciesEmoji[a.species] ?? ""} ` : ""}
                      {a.herd_group_name ?? "Group"}
                    </p>
                    <p className="text-xs text-stone-500">
                      Turned out {turnout} · {daysBetween(turnout, today)} days in pasture
                      {lastMoveIn?.head_count != null ? ` · ${lastMoveIn.head_count} head (from the last move record)` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Mobile actions — all ≥44px tap targets */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={actionBtnCls} onClick={() => onAction({ kind: "activity", pasture })}>
            📋 Record activity
          </button>
          <button type="button" className={actionBtnCls} onClick={() => onAction({ kind: "move", pasture })}>
            🐄 Move group
          </button>
          <button type="button" className={actionBtnCls} onClick={() => onAction({ kind: "condition", pasture })}>
            🌱 Update condition
          </button>
          <button type="button" className={actionBtnCls} onClick={() => onAction({ kind: "water", pasture })}>
            💧 Update water
          </button>
        </div>

        {/* Activity timeline — each entry can be corrected: Edit reopens the
            activity form (the linked expense follows), Delete removes the
            activity and its linked expense together after confirmation. */}
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-stone-800">Activity timeline</h4>
          {activities.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-500">
              No activities recorded on this pasture yet.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-100">
              {activities.slice(0, 20).map((a) => (
                <li key={a.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="w-24 shrink-0 text-xs font-semibold text-stone-500">{a.activity_date}</span>
                    <span className="font-medium text-stone-800">{ACTIVITY_TYPE_LABEL[a.activity_type] ?? a.activity_type}</span>
                    <span className="ml-auto text-xs text-stone-600">{money(a.cost_cents)}</span>
                  </div>
                  {a.notes && <p className="text-xs text-stone-500">{a.notes}</p>}
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEditActivity(a)}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:border-green-700 hover:text-green-800"
                      title="Edit this activity — the linked expense follows it"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeleting(a); setDeleteError(null); }}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:border-red-700 hover:bg-red-50"
                      title="Delete this activity and its linked expense"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Movement history — group moves only (see header comment) */}
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-stone-800">Group movement history</h4>
          {movements.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-500">
              No group moves recorded for this pasture yet.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-100">
              {movements.slice(0, 20).map((m) => {
                const into = m.to_pasture_id === pasture.id;
                const other = into ? pastureName(m.from_pasture_id) : pastureName(m.to_pasture_id);
                return (
                  <li key={m.id} className="px-3 py-2 text-sm">
                    <p className="text-stone-800">
                      <span className="mr-2 inline-block w-24 text-xs font-semibold text-stone-500">{m.move_date}</span>
                      <span className="font-medium">{m.herd_group_name ?? "Group"}</span>{" "}
                      {into ? "moved in" : "moved out"}
                      {other ? ` ${into ? "from" : "to"} ${other}` : ""}
                      {m.head_count != null ? ` · ${m.head_count} head` : ""}
                    </p>
                    {m.notes && <p className="text-xs text-stone-500">{m.notes}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
      {/* Delete confirmation — states the exact behavior: the activity and its
          linked expense go together, in one step. */}
      {deleting ? (
        <Modal
          title="Delete this activity?"
          sub={`${deleting.activity_date} · ${ACTIVITY_TYPE_LABEL[deleting.activity_type] ?? deleting.activity_type} · ${money(deleting.cost_cents)}`}
          onClose={() => { setDeleting(null); setDeleteError(null); }}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => { setDeleting(null); setDeleteError(null); }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletingBusy}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60 sm:w-auto sm:px-5"
              >
                {deletingBusy ? "Deleting…" : "Delete activity"}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {deleteError && <ErrorNote error={deleteError} />}
            <p className="text-sm font-semibold text-stone-800">
              Delete this activity and its linked expense?
            </p>
            <p className="text-sm text-stone-600">
              Both go together in one step: the activity is removed from this timeline and its linked Land / pasture
              expense is removed from the expense ledger. This can&apos;t be undone.
            </p>
            {deleting.cost_cents == null && (
              <p className="text-sm text-stone-500">
                This activity has no linked expense — only the activity record is removed.
              </p>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Record / EDIT activity — date, type (10 kinds), optional cost, notes, and
// the "Record as expense" checkbox (default ON). With cost + checked, ONE
// linked Land / pasture expense is created; in edit mode the linked expense
// follows the server rules (upserted when cost>0 AND checked, removed when
// blank/0 or unchecked) — there is no separate expense editing.
// ---------------------------------------------------------------------------

export function ActivityFormModal({
  pasture,
  editing = null,
  onClose,
  onSaved,
}: {
  pasture: Pasture;
  /** Present → the form edits this activity (no idempotency key needed: the
   *  edit is absolute-value-set, so a retried edit lands in the same place). */
  editing?: PastureActivity | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [activityDate, setActivityDate] = useState(editing?.activity_date ?? todayStr());
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>(editing?.activity_type ?? "inspection");
  const [costDollars, setCostDollars] = useState(
    editing?.cost_cents != null ? (editing.cost_cents / 100).toFixed(2) : ""
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [recordExpense, setRecordExpense] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ONE idempotency key per form-open (create only). Never regenerated on
  // retry — the server dedupes on it, so a double-tap can't record the
  // activity twice.
  const [clientRequestId] = useState(() => newClientRequestId());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const cents = costDollars.trim() === "" ? null : Math.round(Number(costDollars) * 100);
    const safeCents = cents != null && Number.isFinite(cents) && cents > 0 ? cents : null;
    if (editing) {
      const res = await updatePastureActivity({
        data: {
          id: editing.id,
          activity_date: activityDate,
          activity_type: activityType,
          cost_cents: safeCents,
          notes: notes.trim() ? notes.trim() : null,
          record_expense: recordExpense,
        },
      });
      if (res.ok) {
        onSaved(
          res.expense_linked
            ? "Activity updated — the linked expense now matches it."
            : "Activity updated — its linked expense was removed."
        );
        return;
      }
      setSaving(false);
      setError(res.error);
      return;
    }
    const res = await savePastureActivity({
      data: {
        client_request_id: clientRequestId,
        pasture_id: pasture.id,
        activity_date: activityDate,
        activity_type: activityType,
        cost_cents: safeCents,
        notes: notes.trim() ? notes.trim() : null,
        record_expense: recordExpense,
      },
    });
    if (res.ok) {
      // A duplicate (same request id — e.g. a double-tap) changed nothing;
      // surface the exact duplicate message so the operator knows.
      onSaved(
        res.duplicate
          ? PASTURE_ACTIVITY_DUPLICATE_MESSAGE
          : res.expense_created
            ? "Activity recorded and a Land / pasture expense was linked."
            : "Activity recorded."
      );
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title={editing ? `Edit activity — ${pasture.name}` : `Record activity — ${pasture.name}`}
      sub={
        editing
          ? "Changes save absolutely; the linked expense follows (no separate expense editing)"
          : "Pasture work log; with a cost it can also be an expense"
      }
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmitLabel={editing ? "Save changes" : "Record activity"}
          saving={saving}
          formId="pasture-activity-form"
        />
      }
    >
      <form id="pasture-activity-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date *">
            <input type="date" className={inputCls} value={activityDate} onChange={(e) => setActivityDate(e.target.value)} required />
          </Field>
          <Field label="Activity type *">
            <select
              className={inputCls}
              value={activityType}
              onChange={(e) => setActivityType(e.target.value as (typeof ACTIVITY_TYPES)[number])}
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>{ACTIVITY_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Cost ($)">
            <input
              type="number" min={0} step={0.01}
              inputMode="decimal"
              className={inputCls}
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Notes">
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="East fence line, corner posts…" />
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5">
          <input
            type="checkbox"
            className="h-5 w-5 accent-green-800"
            checked={recordExpense}
            onChange={(e) => setRecordExpense(e.target.checked)}
          />
          <span className="text-sm text-stone-700">
            Record as expense
            <span className="block text-xs text-stone-500">
              {editing
                ? "With a cost entered, the linked Land / pasture expense is created or updated to match; clear the cost (or uncheck) and any linked expense is removed."
                : "With a cost entered, creates a linked Land / pasture expense."}
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Move group — the ONLY movement action, and it is explicitly group-based:
// "Move group", "Group moved to …". Never animal-by-animal. Server rules (no
// self-move, no cross-operation ids, no negative head count) surface here.
// ---------------------------------------------------------------------------

export function MoveGroupModal({
  pasture,
  data,
  onClose,
  onSaved,
}: {
  pasture: Pasture;
  data: PastureData;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [toPastureId, setToPastureId] = useState<number | null>(
    data.pastures.find((p) => p.id !== pasture.id)?.id ?? null
  );
  const [moveDate, setMoveDate] = useState(todayStr());
  const [headCount, setHeadCount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId) {
      setError("Pick the herd/group to move.");
      return;
    }
    if (!toPastureId) {
      setError("Pick the destination pasture.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await moveLivestock({
      data: {
        herd_group_id: groupId,
        to_pasture_id: toPastureId,
        move_date: moveDate,
        head_count: headCount === "" ? null : Number(headCount),
        notes: notes.trim() ? notes.trim() : null,
      },
    });
    if (res.ok) {
      const dest = data.pastures.find((p) => p.id === toPastureId)?.name ?? "the destination pasture";
      onSaved(`Group moved to ${dest}.`);
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title={`Move group — ${pasture.name}`}
      sub="Moves one herd group between pastures (group-level, not per-animal)"
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmitLabel="Move group" saving={saving} formId="pasture-move-form" />}
    >
      <form id="pasture-move-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <Field label="Herd / group to move *">
          <select className={inputCls} value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— pick a group —</option>
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}{g.species ? ` (${g.species})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Groups are moved as a unit — individual animals aren&apos;t tracked pasture-by-pasture.
          </p>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Destination pasture *">
            <select className={inputCls} value={toPastureId ?? ""} onChange={(e) => setToPastureId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— pick a pasture —</option>
              {data.pastures.filter((p) => p.id !== pasture.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Move date *">
            <input type="date" className={inputCls} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} required />
          </Field>
          <Field label="Head count">
            <input
              type="number" min={0} step={1}
              inputMode="numeric"
              className={inputCls}
              value={headCount}
              onChange={(e) => setHeadCount(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Notes">
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why the move, pairings…" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Quick field update — condition or water status, saved through the same
// operation-scoped savePasture the edit form uses (full record + the change).
// ---------------------------------------------------------------------------

export function QuickFieldModal({
  pasture,
  field,
  onClose,
  onSaved,
}: {
  pasture: Pasture;
  field: "condition" | "water_status";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isCondition = field === "condition";
  const [value, setValue] = useState(isCondition ? pasture.condition : pasture.water_status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: PastureInput = {
      id: pasture.id,
      name: pasture.name,
      size_acres: pasture.size_acres,
      location: pasture.location,
      status: pasture.status,
      pasture_type: pasture.pasture_type,
      capacity_heads: pasture.capacity_heads,
      water_status: isCondition ? pasture.water_status : (value as Pasture["water_status"]),
      condition: isCondition ? (value as Pasture["condition"]) : pasture.condition,
      soil_type: pasture.soil_type,
      notes: pasture.notes,
    };
    const res = await savePasture({ data: payload });
    if (res.ok) {
      onSaved(isCondition ? "Condition updated." : "Water status updated.");
    } else {
      setSaving(false);
      setError(res.error);
    }
  };

  return (
    <Modal
      title={isCondition ? `Update condition — ${pasture.name}` : `Update water status — ${pasture.name}`}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmitLabel="Save" saving={saving} formId="pasture-quick-form" />}
    >
      <form id="pasture-quick-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote error={error} />}
        <Field label={isCondition ? "Condition" : "Water status"}>
          <select
            className={inputCls}
            value={value}
            onChange={(e) => setValue(e.target.value as Pasture["condition"] & Pasture["water_status"])}
          >
            {(isCondition ? PASTURE_CONDITIONS : WATER_STATUSES).map((s) => (
              <option key={s} value={s}>{capFirst(s)}</option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
