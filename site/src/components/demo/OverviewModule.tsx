import { useState } from "react";
import { Badge, Card, CardTitle, ProgressBar, Stat } from "~/components/ui";
import type { Reminder } from "~/data/sample";
import type { DemoSiteData } from "~/data/demoSites";

export function OverviewModule({ data }: { data: DemoSiteData }) {
  const [sortBy, setSortBy] = useState<"due" | "category">("due");
  const [reminders, setReminders] = useState<Reminder[]>(data.reminders.map((r) => ({ ...r })));

  const markDone = (id: string) =>
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));

  const maxHead = Math.max(...data.livestock.map((s) => s.head));
  const maxCost = Math.max(...data.costsYtd.map((c) => c.ytd));
  const lowStock = data.feedInventory.filter((f) => f.onHand < f.reorderAt);
  const maint = data.equipment.filter((e) => e.status !== "In service").length;
  const sortable = [...reminders].sort((a, b) =>
    sortBy === "due" ? a.daysLeft - b.daysLeft : a.category.localeCompare(b.category)
  );
  const shown = sortable.slice(0, 5);
  const grazed = data.pastures.filter((p) => p.restDays === 0).length;

  return (
    <div className="space-y-5">
      {/* headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total livestock" value={data.totalHead.toLocaleString()} sub={`${data.totalAu.toLocaleString()} animal units`} />
        <Stat label="Hay on hand" value={`${data.hayOnHandBales} bales`} sub={`${lowStock.length} items below reorder`} />
        <Stat label="Equipment needing service" value={String(maint)} sub={`${data.equipment.length} units tracked`} />
        <Stat label="YTD operating cost" value={`$${Math.round(data.totalYtd / 1000)}k`} sub="all categories" accent />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* livestock bar chart */}
        <Card className="lg:col-span-1">
          <CardTitle title="Livestock by species" sub={`Head count at ${data.siteName}`} />
          <div className="space-y-3">
            {data.livestock.filter((s) => s.head > 0).map((s) => (
              <div key={s.key} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-stone-600">{s.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(s.head / maxHead) * 100}%`, backgroundColor: s.color }} />
                </div>
                <span className="w-12 text-right text-xs font-semibold text-stone-700">{s.head.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-green-50 p-3 text-xs text-green-900">
            Open <b>Livestock</b> to dive into this ranch's herd details.
          </div>
        </Card>

        {/* upcoming reminders */}
        <Card className="lg:col-span-2">
          <CardTitle
            title="Upcoming reminders"
            sub="Overdue & upcoming registrations, inspections, renewals"
            right={
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "due" | "category")} className="rounded-lg border border-stone-300 px-2 py-1 text-xs">
                <option value="due">Sort: due date</option>
                <option value="category">Sort: category</option>
              </select>
            }
          />
          <ul className="divide-y divide-stone-100">
            {shown.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" checked={r.done} onChange={() => markDone(r.id)} className="h-4 w-4 accent-green-700" />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${r.done ? "text-stone-400 line-through" : "text-stone-800"}`}>{r.title}</p>
                  <p className="text-xs text-stone-500">{r.category}</p>
                </div>
                {r.daysLeft < 0 ? (
                  <Badge tone="red">{Math.abs(r.daysLeft)}d overdue</Badge>
                ) : r.daysLeft <= 10 ? (
                  <Badge tone="amber">{r.daysLeft}d left</Badge>
                ) : (
                  <Badge tone="green">{r.daysLeft}d</Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-400">Table is sortable and items are checkable in this interactive sample.</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* low stock */}
        <Card>
          <CardTitle title="Hay & feed reorder alerts" sub="Items at or below their reorder point" />
          <ul className="space-y-3">
            {lowStock.map((f) => (
              <li key={f.item} className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{f.item}</p>
                    <p className="text-xs text-stone-500">{f.vendor} · ${f.costPerUnit}/{f.unit}</p>
                  </div>
                  <Badge tone="red">Reorder</Badge>
                </div>
                <div className="mt-2">
                  <ProgressBar value={f.onHand} max={f.reorderAt * 1.5} color="#b91c1c" />
                  <p className="mt-1 text-xs text-stone-500">
                    {f.onHand} {f.unit} on hand · reorder at {f.reorderAt}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* cost donut-ish bars */}
        <Card>
          <CardTitle title="YTD cost by category" sub="Sample cost reporting" />
          <div className="space-y-3">
            {data.costsYtd.map((c) => (
              <div key={c.label} className="flex items-center gap-3">
                <span className="w-32 text-xs font-medium text-stone-600">{c.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(c.ytd / maxCost) * 100}%`, backgroundColor: c.color }} />
                </div>
                <span className="w-16 text-right text-xs font-semibold text-stone-700">${c.ytd.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* pasture health strip */}
      <Card>
        <CardTitle title="Pasture forage condition" sub={`Across ${data.pastures.length} pastures · ${grazed} currently grazed`} />
        <div className="flex flex-wrap gap-3">
          {data.pastures.map((p) => {
            const tone = p.forageCondition === "Excellent" ? "green" : p.forageCondition === "Good" ? "blue" : p.forageCondition === "Fair" ? "amber" : "red";
            return (
              <div key={p.id} className="flex flex-col rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                <span className="text-sm font-semibold text-stone-800">{p.name}</span>
                <span className="text-xs text-stone-500">{p.acres} ac · {p.utilization}% used</span>
                <span className="mt-1"><Badge tone={tone as "green" | "blue" | "amber" | "red"}>{p.forageCondition}</Badge></span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
