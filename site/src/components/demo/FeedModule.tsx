import { useState } from "react";
import { Badge, Card, CardTitle, ProgressBar, Stat } from "~/components/ui";
import type { DemoSiteData } from "~/data/demoSites";

export function FeedModule({ data }: { data: DemoSiteData }) {
  const inventory = data.feedInventory;
  const totalBales = inventory.filter((f) => f.unit === "bales").reduce((s, f) => s + f.onHand, 0);
  const lowStock = inventory.filter((f) => f.onHand < f.reorderAt);
  const hayItems = inventory.filter((f) => f.unit === "bales");
  const monthlyHayBales = Math.round(hayItems.reduce((s, f) => s + f.monthlyUse, 0));
  const avgHayCost = hayItems.length ? Math.round(hayItems.reduce((s, f) => s + f.costPerUnit, 0) / hayItems.length) : 0;
  const [view, setView] = useState<"all" | "low">("all");
  const list = view === "low" ? lowStock : inventory;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Hay bales on hand" value={`${totalBales.toLocaleString()} bales`} sub={`at ${data.siteName}`} accent />
        <Stat label="Low-stock alerts" value={String(lowStock.length)} sub="below reorder point" />
        <Stat label="Monthly hay usage" value={`~${monthlyHayBales} bales`} sub="projected" />
        <Stat label="Avg hay cost" value={`$${avgHayCost}/bale`} sub="blended" />
      </div>

      <Card>
        <CardTitle
          title="Feed inventory"
          sub="On-hand levels vs. reorder points"
          right={
            <div className="flex gap-1 rounded-lg border border-stone-200 p-1">
              {(["all", "low"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${
                    view === v ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"
                  }`}
                >
                  {v === "all" ? "All items" : "Low stock"}
                </button>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4 text-right">On hand</th>
                <th className="py-2 pr-4 text-right">Reorder at</th>
                <th className="py-2 pr-4">Level</th>
                <th className="py-2 pr-4 text-right">Unit cost</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {list.map((f) => {
                const low = f.onHand < f.reorderAt;
                return (
                  <tr key={f.item} className={low ? "bg-red-50/40" : ""}>
                    <td className="py-3 pr-4 font-medium text-stone-800">{f.item}</td>
                    <td className="py-3 pr-4"><Badge tone={f.type === "Hay" ? "green" : f.type === "Grain" ? "amber" : "blue"}>{f.type}</Badge></td>
                    <td className="py-3 pr-4 text-right font-semibold">{f.onHand} {f.unit}</td>
                    <td className="py-3 pr-4 text-right text-stone-500">{f.reorderAt}</td>
                    <td className="w-40 py-3 pr-4">
                      <ProgressBar value={f.onHand} max={f.reorderAt * 1.5} color={low ? "#b91c1c" : "#5a7d3a"} />
                    </td>
                    <td className="py-3 pr-4 text-right">${f.costPerUnit}</td>
                    <td className="py-3">{low ? <Badge tone="red">Reorder</Badge> : <Badge tone="green">In stock</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-stone-400">
          Monthly usage is projected forward to estimate when each item hits its reorder point. Sample data.
        </p>
      </Card>
    </div>
  );
}
