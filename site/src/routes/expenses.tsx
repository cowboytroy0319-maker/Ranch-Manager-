import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { deleteExpense, getExpensesData } from "~/server/expenses";
import { getQuickAddRefs } from "~/server/refs";
import { CATEGORY_LABEL, type ExpenseCategory } from "~/types/expenses";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { ExpenseFormModal } from "~/components/expenses/ExpenseForm";
import { EXPENSE_CATEGORIES } from "~/types/expenses";
import {
  EXPENSE_ADD_INTENTS,
  MANUAL_SOURCE_LABEL,
  expenseFilterFromSearch,
  expenseSourceIndicator,
} from "~/components/expenses/expenseUI";
import { useAddIntent } from "~/components/useAddIntent";
import { TemplatesLink } from "~/components/TemplatesLink";
import { Modal, ErrorNote } from "~/components/sheet-modal";

export const Route = createFileRoute("/expenses")({
  validateSearch: (search: Record<string, unknown>) => expenseFilterFromSearch(search),

  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    category: search.category,
  }),

  loader: async ({ deps }) => {
    const [data, refs] = await Promise.all([
      getExpensesData({ data: { from: deps.from, to: deps.to, category: (deps.category as ExpenseCategory | undefined) ?? null } }),
      getQuickAddRefs(),
    ]);
    return { data, refs };
  },
  component: ExpensesPage,
});

const fmt = (cents: number) =>
  "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const catTone = (c: string): "green" | "amber" | "blue" | "red" | "stone" => {
  switch (c) {
    case "hay_feed":
      return "green";
    case "veterinary":
      return "red";
    case "repairs_maintenance":
      return "amber";
    case "insurance":
    case "fuel":
      return "blue";
    default:
      return "stone";
  }
};
type Dim = "category" | "herd" | "pasture" | "equipment" | "job";

// Row action buttons — ≥44px tap targets for one-handed phone use.
const rowBtnCls =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-green-700 hover:text-green-800";
const filterInputCls =
  "min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20";

function ExpensesPage() {
  const { data, refs } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const refresh = () => router.invalidate();

  const [dim, setDim] = useState<Dim>("category");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<(typeof data.rows)[number] | null>(null);
  const [deleting, setDeleting] = useState<(typeof data.rows)[number] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // ?add=expense (MobileNav Quick Add) opens the create sheet directly.
  const { add, clear: clearAdd } = useAddIntent(EXPENSE_ADD_INTENTS);
  const createOpen = formOpen || add === "expense";
  const closeCreate = () => {
    setFormOpen(false);
    if (add === "expense") clearAdd();
  };

  const setFilter = (patch: { from?: string; to?: string; category?: string }) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const filtersActive = Boolean(search.from || search.to || search.category);
  const clearFilters = () =>
    void navigate({ search: (prev) => ({ ...prev, from: undefined, to: undefined, category: undefined }) });

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    setDeleteError(null);
    const res = await deleteExpense({ data: deleting.id });
    setDeletingBusy(false);
    if (res.ok) {
      setDeleting(null);
      refresh();
    } else {
      setDeleteError(res.error);
    }
  };

  // Lookup map for per-category totals (also used by the top stats).
  const catMap = new Map(data.byCategory.map((c) => [c.category, c] as const));
  const cat = (c: ExpenseCategory) => catMap.get(c);
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🧾 Database not configured"
            sub="Expense records persist to Postgres — no connection string is set in this environment."
          />
          <p className="text-sm text-amber-800">
            Once a database is connected, <code>db:migrate</code> creates the{" "}
            <code>expenses</code> table and this page will show the current-month cost ledger,
            per-category totals, and multi-dimensional cost-allocation breakdowns.
          </p>
        </Card>
      </Shell>
    );
  }

  const rangeLabel = filtersActive
    ? [search.from ?? "any start", search.to ?? "any end"].join(" → ")
    : data.month || "this month";

  const dimRows =
    dim === "herd"
      ? data.byHerd
      : dim === "pasture"
        ? data.byPasture
        : dim === "equipment"
          ? data.byEquipment
          : dim === "job"
            ? data.byJob
            : (data.byCategory.map((c) => ({ name: CATEGORY_LABEL[c.category], amount_cents: c.amount_cents, entries: c.entries })) as { name: string; amount_cents: number; entries: number }[]);
  const maxCost = Math.max(1, ...dimRows.map((r) => r.amount_cents));
  const hasRows = data.rows.length > 0;

  return (
    <Shell>
      {data.error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{data.error}</div>
      )}

      {/* Top stats — reflect the active filter scope */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label={filtersActive ? "Filtered total" : "This month"} value={hasRows || filtersActive ? fmt(data.totalCents) : "—"} sub={rangeLabel} accent />
        <Stat label="Entries" value={String(data.totalEntries)} sub="expense lines" />
        <Stat label="Feed & Hay" value={cat("hay_feed") ? fmt(cat("hay_feed")!.amount_cents) : "—"} sub={`${cat("hay_feed")?.entries ?? 0} entries`} />
        <Stat label="Vet & Health" value={cat("veterinary") ? fmt(cat("veterinary")!.amount_cents) : "—"} sub={`${cat("veterinary")?.entries ?? 0} entries`} />
        <Stat label="Repairs & Maint." value={cat("repairs_maintenance") ? fmt(cat("repairs_maintenance")!.amount_cents) : "—"} sub={`${cat("repairs_maintenance")?.entries ?? 0} entries`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Ledger — mobile-first list (cards, no horizontal scroll at 375px) */}
        <Card className="lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle
              title={filtersActive ? "Filtered expenses" : "This month's expenses"}
              sub={`${rangeLabel} · ${data.totalEntries} entries`}
              right={<Badge tone="amber">Real data</Badge>}
            />
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary min-h-11 !px-4 !py-2.5 text-sm">
              ＋ Add expense
            </button>
          </div>

          {/* Filters — date range + category; driven by the URL so back works */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">From</span>
              <input
                type="date"
                className={filterInputCls}
                value={search.from ?? ""}
                onChange={(e) => setFilter({ from: e.target.value || undefined })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">To</span>
              <input
                type="date"
                className={filterInputCls}
                value={search.to ?? ""}
                onChange={(e) => setFilter({ to: e.target.value || undefined })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Category</span>
              <select
                className={filterInputCls}
                value={search.category ?? ""}
                onChange={(e) => setFilter({ category: e.target.value || undefined })}
              >
                <option value="">All categories</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </label>
          </div>
          {filtersActive && (
            <button onClick={clearFilters} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-green-700 underline underline-offset-2">
              ✕ Clear filters
            </button>
          )}

          {hasRows ? (
            <ul className="mt-3 divide-y divide-stone-100">
              {data.rows.map((r) => {
                const indicator = expenseSourceIndicator(r);
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-stone-500">{r.expense_date}</span>
                          <Badge tone={catTone(r.category)}>{CATEGORY_LABEL[r.category]}</Badge>
                          <span className="text-lg font-bold text-stone-900">{fmt(r.amount_cents)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-sm font-medium text-stone-800">{r.vendor ?? "—"}</p>
                        <p className="truncate text-xs text-stone-500">
                          {[r.herd_group_name, r.pasture_name, r.equipment_name, r.job].filter(Boolean).join(" · ") || "Unallocated"}
                          {r.paid_by ? ` · paid by ${r.paid_by}` : ""}
                        </p>
                        {indicator ? (
                          <p className="mt-1 text-xs">
                            <Link to={indicator.to} className="font-semibold text-green-700 underline underline-offset-2" title={indicator.hint}>
                              {indicator.label}
                            </Link>
                            <span className="text-stone-400"> — {indicator.hint}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-stone-400">{MANUAL_SOURCE_LABEL} entry</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        {!r.linked && (
                          <button onClick={() => { setEditing(r); setFormOpen(true); }} className={rowBtnCls}>
                            Edit
                          </button>
                        )}
                        <button onClick={() => { setDeleting(r); setDeleteError(null); }} className={rowBtnCls}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-stone-300 p-6 text-center">
              <p className="text-sm font-semibold text-stone-700">
                {filtersActive ? "No expenses match these filters." : "No expenses logged yet."}
              </p>
              {!filtersActive && (
                <>
                  <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary mt-3 min-h-11 !px-4 !py-2.5 text-sm">
                    ＋ Add expense
                  </button>
                  <TemplatesLink className="mt-3" />
                </>
              )}
            </div>
          )}
          {hasRows && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
              <span className="text-sm font-semibold text-green-900">Total · {rangeLabel}</span>
              <span className="text-lg font-bold text-green-900">{fmt(data.totalCents)}</span>
            </div>
          )}
        </Card>

        {/* Cost-allocation breakdown — wraps safely at 375px (no wide tables) */}
        <Card className="lg:col-span-2">
          <CardTitle title="Cost allocation" sub="Break the range down by dimension" right={<Badge tone="green">Differentiator</Badge>} />
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-stone-200 p-1">
            {(["category", "herd", "pasture", "equipment", "job"] as Dim[]).map((d) => (
              <button
                key={d}
                onClick={() => setDim(d)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize transition ${dim === d ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}
              >
                {d === "category" ? "Category" : d === "herd" ? "Per herd" : d === "pasture" ? "Per pasture" : d === "equipment" ? "Per equipment" : "Per job"}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-stone-100">
            {dimRows.map((r, i) => (
              <li key={r.name} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-stone-800" title={r.name}>{r.name}</span>
                  <span className="shrink-0 text-sm font-bold text-stone-900">{fmt(r.amount_cents)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full" style={{ width: `${(r.amount_cents / maxCost) * 100}%`, backgroundColor: ["#5a7d3a", "#8a5a2b", "#7b8fa3", "#b98a3a", "#4a6b8a", "#8a4a4a", "#5a8a78", "#6b5a8a"][i % 8] }} />
                  </div>
                  <span className="shrink-0 text-xs text-stone-400">{r.entries}×</span>
                </div>
              </li>
            ))}
            {dimRows.length === 0 && <li className="py-3 text-sm text-stone-500">No expense spend to allocate for this range.</li>}
          </ul>
          {data.totalEntries > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-stone-100 p-3">
              <span className="text-sm font-semibold text-stone-700">Grand total</span>
              <span className="text-lg font-bold text-stone-900">{fmt(data.totalCents)}</span>
            </div>
          )}
        </Card>
      </div>

      {/* Create / edit sheet */}
      {createOpen || editing ? (
        <ExpenseFormModal
          key={editing ? `edit-${editing.id}` : "add-expense"}
          editing={editing && !editing.linked ? editing : null}
          refs={refs}
          onClose={() => {
            setEditing(null);
            closeCreate();
          }}
          onSaved={() => {
            setEditing(null);
            closeCreate();
            refresh();
          }}
        />
      ) : null}

      {/* Delete confirmation — linked deletes are blocked server-side and the
          safe message is surfaced here verbatim. */}
      {deleting ? (
        <Modal
          title="Delete expense?"
          sub={`${deleting.expense_date} · ${CATEGORY_LABEL[deleting.category]} · ${fmt(deleting.amount_cents)}`}
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
                {deletingBusy ? "Deleting…" : "Delete expense"}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {deleteError && <ErrorNote error={deleteError} />}
            <p className="text-sm text-stone-600">
              This removes the expense line from your ledger. Linked expenses (created from a hay/feed restock or a pasture
              activity) can&apos;t be deleted here — undo the source record instead.
            </p>
          </div>
        </Modal>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      badge="Expenses"
      eyebrow="Cost module · live database"
      title="Expenses &amp; Cost Allocation"
      subtitle="Every dollar tagged to the herd, pasture, equipment, or job that spent it — so cost per head, acre, bale, and mile are answerable."
    >
      {children}
    </AppShell>
  );
}
