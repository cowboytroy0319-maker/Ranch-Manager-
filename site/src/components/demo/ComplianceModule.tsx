import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import type { ComplianceItem } from "~/data/sample";
import type { DemoSiteData } from "~/data/demoSites";

const kindTone = (k: string) =>
  k === "Registration" ? "blue" : k === "Inspection" ? "amber" : k === "Insurance" ? "green" : "stone";

export function ComplianceModule({ data }: { data: DemoSiteData }) {
  const [items, setItems] = useState(data.compliance.map((c) => ({ ...c, done: false })));
  const [sortBy, setSortBy] = useState<"due" | "category">("due");

  const toggle = (id: string) => setItems((ls) => ls.map((c) => (c.id === id ? { ...c, done: !c.done } : c)));
  const open = items.filter((c) => !c.done).length;
  const totalCost = items.reduce((s, c) => s + c.cost, 0);

  const sorted = [...items].sort((a: ComplianceItem, b: ComplianceItem) =>
    sortBy === "due"
      ? a.daysLeft - b.daysLeft
      : a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open items" value={String(open)} sub="not yet renewed/filed" accent />
        <Stat label="Last 12-mo renewals" value={String(items.length)} sub="across all sites" />
        <Stat label="Renewal cost YTD" value={`$${totalCost.toLocaleString()}`} sub="sample total" />
        <Stat label="Overdue now" value={String(items.filter((c) => c.daysLeft < 0).length)} sub="needs attention today" />
      </div>

      <Card>
        <CardTitle
          title="Registrations, inspections & renewals"
          sub="Sort by due date or category — check an item to mark complete"
          right={
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "due" | "category")} className="rounded-lg border border-stone-300 px-2 py-1 text-xs">
              <option value="due">Sort: due date</option>
              <option value="category">Sort: category</option>
            </select>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2 pr-4">Renews</th>
                <th className="py-2 pr-4 text-right">Cost</th>
                <th className="py-2 pr-4">Due</th>
                <th className="py-2">Done</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((c) => (
                <tr key={c.id} className={c.daysLeft < 0 && !c.done ? "bg-red-50/50" : ""}>
                  <td className={`py-3 pr-4 font-medium ${c.done ? "text-stone-400 line-through" : "text-stone-800"}`}>{c.title}</td>
                  <td className="py-3 pr-4"><Badge tone={kindTone(c.kind) as "blue" | "amber" | "green" | "stone"}>{c.kind}</Badge></td>
                  <td className="py-3 pr-4 text-stone-600">{c.entity}</td>
                  <td className="py-3 pr-4 text-stone-600">{c.renews}</td>
                  <td className="py-3 pr-4 text-right text-stone-600">${c.cost.toLocaleString()}</td>
                  <td className="py-3 pr-4">
                    {c.daysLeft < 0 ? <Badge tone="red">{Math.abs(c.daysLeft)}d overdue</Badge> : c.daysLeft <= 30 ? <Badge tone="amber">{c.daysLeft}d</Badge> : <Badge tone="green">{c.daysLeft}d</Badge>}
                  </td>
                  <td className="py-3">
                    <input type="checkbox" checked={c.done} onChange={() => toggle(c.id)} className="h-4 w-4 accent-green-700" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-stone-400">Registrations, inspections, insurance renewals, and licenses all roll up here. Sortable sample data.</p>
      </Card>
    </div>
  );
}
