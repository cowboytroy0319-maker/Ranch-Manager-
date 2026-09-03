import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { getExpensesData } from "~/server/expenses";
import { CATEGORY_LABEL, type ExpenseCategory } from "~/types/expenses";
import { getSession } from "~/server/auth";

export const Route = createFileRoute("/expenses")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getExpensesData(),
  component: ExpensesPage,
});

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const catTone = (c: string): "green" | "amber" | "blue" | "red" | "stone" => {
  switch (c) {
    case "feed":
      return "green";
    case "vet_health":
      return "red";
    case "maintenance":
      return "amber";
    case "insurance":
      return "blue";
    default:
      return "stone";
  }
};
type Dim = "category" | "herd" | "pasture" | "equipment" | "job";

function ExpensesPage() {
  const data = Route.useLoaderData();
  const [dim, setDim] = useState<Dim>("category");
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
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="This month" value={hasRows ? fmt(data.totalCents) : "—"} sub={`${data.month || "this month"}`} accent />
        <Stat label="Entries" value={String(data.totalEntries)} sub="expense lines" />
        <Stat label="Feed & Hay" value={cat("feed") ? fmt(cat("feed")!.amount_cents) : "—"} sub={`${cat("feed")?.entries ?? 0} entries`} />
        <Stat label="Vet & Health" value={cat("vet_health") ? fmt(cat("vet_health")!.amount_cents) : "—"} sub={`${cat("vet_health")?.entries ?? 0} entries`} />
        <Stat label="Maintenance" value={cat("maintenance") ? fmt(cat("maintenance")!.amount_cents) : "—"} sub={`${cat("maintenance")?.entries ?? 0} entries`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Current-month ledger */}
        <Card className="lg:col-span-3">
          <CardTitle title="This month's expenses" sub={`${data.month} · ${data.totalEntries} entries`} right={<Badge tone="amber">Real data</Badge>} />
          {hasRows ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Vendor</th>
                    <th className="py-2 pr-3">Allocated to</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.rows.map((r) => (
                    <tr key={r.id} className="transition hover:bg-green-50/50">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs font-semibold text-stone-500">{r.expense_date}</td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={catTone(r.category)}>{CATEGORY_LABEL[r.category]}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-stone-700">{r.vendor ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-stone-600">
                        {[r.herd_group_name && `${r.herd_group_name}${r.species ? ` · ${r.species}` : ""}`, r.pasture_name, r.equipment_name, r.job]
                          .filter(Boolean)
                          .join(" → ") || "—"}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium text-stone-800">{fmt(r.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-stone-500">No expenses logged this month yet.</p>
          )}
          {hasRows && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
              <span className="text-sm font-semibold text-green-900">Total · {data.month}</span>
              <span className="text-lg font-bold text-green-900">{fmt(data.totalCents)}</span>
            </div>
          )}
        </Card>
        {/* Cost-allocation breakdown */}
        <Card className="lg:col-span-2">
          <CardTitle title="Cost allocation" sub="Break the month down by dimension" right={<Badge tone="green">Differentiator</Badge>} />
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-stone-200 p-1">
            {(["category", "herd", "pasture", "equipment", "job"] as Dim[]).map((d) => (
              <button
                key={d}
                onClick={() => setDim(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition ${dim === d ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}
              >
                {d === "category" ? "Category" : d === "herd" ? "Per herd" : d === "pasture" ? "Per pasture" : d === "equipment" ? "Per equipment" : "Per job"}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-stone-100">
            {dimRows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-3 py-2.5">
                <div className="w-40 shrink-0 truncate" title={r.name}>
                  <Badge tone="green">{r.name}</Badge>
                </div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(r.amount_cents / maxCost) * 100}%`, backgroundColor: ["#5a7d3a", "#8a5a2b", "#7b8fa3", "#b98a3a", "#4a6b8a", "#8a4a4a", "#5a8a78", "#6b5a8a"][i % 8] }} />
                </div>
                <span className="w-16 text-right text-sm font-semibold text-stone-800">{fmt(r.amount_cents)}</span>
                <span className="w-10 text-right text-xs text-stone-400">{r.entries}×</span>
              </li>
            ))}
            {dimRows.length === 0 && <li className="py-3 text-sm text-stone-500">No expense spend to allocate this month.</li>}
          </ul>
          {data.totalEntries > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-stone-100 p-3">
              <span className="text-sm font-semibold text-stone-700">Grand total · {data.month}</span>
              <span className="text-lg font-bold text-stone-900">{fmt(data.totalCents)}</span>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-stone-100">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            <span className="hidden font-bold text-stone-900 sm:inline">Ranch Manager Pro</span>
          </Link>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            Expenses &amp; Costs
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/livestock" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Livestock
          </Link>
          <Link to="/feed" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Feed &amp; Hay
          </Link>
          <Link to="/pasture" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Pasture
          </Link>
          <Link to="/equipment" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Equipment
          </Link>
          <Link to="/employees" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Employees
          </Link>
          <Link to="/dashboard" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Daily Ops
          </Link>
          <Link to="/analytics" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Analytics
          </Link>
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">Fifth module · live database</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">Expenses &amp; Cost Allocation</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            The current-month operating ledger — what you spent and where every dollar lands across herd, pasture, equipment, job, and category.
          </p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Expenses module (MVP)</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
