import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import type { CostData } from "~/server/costs";
import type { ExpenseData, ExpenseCategory } from "~/types/expenses";
import { CATEGORY_LABEL } from "~/types/expenses";
const fmt = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLORS = ["#5a7d3a", "#8a5a2b", "#7b8fa3", "#b98a3a", "#4a6b8a", "#8a4a4a", "#5a8a78", "#6b5a8a"];
type Dim = "category" | "herd" | "pasture" | "equipment" | "job";
export function CostsSnapshot({ data, expenses }: { data: CostData; expenses: ExpenseData }) {
  const [dim, setDim] = useState<Dim>("herd");
  const fuel = data.fuel;
  const maxFuel = Math.max(1, ...(fuel?.byEquipment.map((r) => r.cost_cents) ?? []));
  // Per-category lookup for the four headline stats.
  const catMap = new Map(expenses.byCategory.map((c) => [c.category, c.amount_cents] as const));
  const cat = (c: ExpenseCategory) => catMap.get(c) ?? 0;
  const sub = (c: ExpenseCategory) => {
    const e = expenses.byCategory.find((x) => x.category === c);
    return e ? `${e.entries} entries` : "no entries";
  };
  const hasExpenses = expenses.totalEntries > 0;
  const dimRows =
    dim === "category"
      ? expenses.byCategory.map((c) => ({ name: CATEGORY_LABEL[c.category], amount_cents: c.amount_cents, entries: c.entries }))
      : dim === "herd"
        ? expenses.byHerd
        : dim === "pasture"
          ? expenses.byPasture
          : dim === "equipment"
            ? expenses.byEquipment
            : expenses.byJob;
  const maxDim = Math.max(1, ...dimRows.map((r) => r.amount_cents));
  const monthLabel = expenses.month || fuel?.month || "this month";
  return (
    <div className="space-y-5">
      {/* Current-month headline */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label={`Fuel — ${fuel?.month ?? "this month"}`} value={fuel ? fmt(fuel.totalCents) : "—"} sub={`${fuel?.totalEntries ?? 0} fill-ups, ${(fuel?.gallons ?? 0).toLocaleString()} gal`} accent />
        <Stat label="Feed & Hay" value={hasExpenses ? fmt(cat("feed")) : "—"} sub={hasExpenses ? sub("feed") : "no expenses"} />
        <Stat label="Vet & Health" value={hasExpenses ? fmt(cat("vet_health")) : "—"} sub={hasExpenses ? sub("vet_health") : "no expenses"} />
        <Stat label="Maintenance" value={hasExpenses ? fmt(cat("maintenance")) : "—"} sub={hasExpenses ? sub("maintenance") : "no expenses"} />
        <Stat label="Insurance" value={hasExpenses ? fmt(cat("insurance")) : "—"} sub={hasExpenses ? sub("insurance") : "no expenses"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Fuel by equipment (fuel_log) */}
        <Card className="lg:col-span-2">
          <CardTitle title="Fuel spend by equipment" sub={`${fuel?.month ?? "this month"} · from your fuel log`} right={<Badge tone="amber">Real data</Badge>} />
          {fuel && fuel.byEquipment.length > 0 ? (
            <div className="space-y-3">
              {fuel.byEquipment.map((r, i) => (
                <div key={r.equipment_name} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs font-medium text-stone-600" title={r.equipment_name}>{r.equipment_name}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full" style={{ width: `${(r.cost_cents / maxFuel) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                  </div>
                  <span className="w-20 text-right text-xs font-semibold text-stone-700">{fmt(r.cost_cents)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No fuel purchases logged this month yet.</p>
          )}
          {fuel && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
              <span className="text-sm font-semibold text-green-900">Fuel total · {fuel.month}</span>
              <span className="text-lg font-bold text-green-900">{fmt(fuel.totalCents)}</span>
            </div>
          )}
        </Card>
        {/* Real multi-dimensional cost allocation from the expenses ledger */}
        <Card className="lg:col-span-3">
          <CardTitle title="Multi-dimensional cost allocation" sub={`${monthLabel} · from the expenses ledger`} right={<Badge tone="green">Differentiator</Badge>} />
          {hasExpenses ? (
            <>
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
                      <div className="h-full rounded-full" style={{ width: `${(r.amount_cents / maxDim) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                    <span className="w-16 text-right text-sm font-semibold text-stone-800">{fmt(r.amount_cents)}</span>
                    <span className="w-10 text-right text-xs text-stone-400">{r.entries}×</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
                <span className="text-sm font-semibold text-green-900">Operating expenses · {expenses.month}</span>
                <span className="text-lg font-bold text-green-900">{fmt(expenses.totalCents)}</span>
              </div>
              <div className="mt-3 text-right">
                <Link to="/expenses" className="text-xs font-semibold text-green-700 hover:text-green-900">
                  View the full expenses ledger →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-500">
              No operating expenses are logged for this month yet — the breakdown (per herd, per pasture, per equipment, per job) will appear
              here as soon as you record them. Fuel always comes from your fuel log.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
