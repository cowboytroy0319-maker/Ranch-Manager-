import { useState } from "react";
import { Card, CardTitle, Stat } from "~/components/ui";
import type { DemoSiteData } from "~/data/demoSites";

export function FuelModule({ data }: { data: DemoSiteData }) {
  const fuel = data.fuelMonthly;
  const maxG = Math.max(...fuel.map((m) => m.gallons));
  const [metric, setMetric] = useState<"gallons" | "cost">("gallons");
  const totalCost = fuel.reduce((s, m) => s + m.cost, 0);
  const totalG = fuel.reduce((s, m) => s + m.gallons, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Fuel on hand" value={`${data.fuelOnHandGallons.toLocaleString()} gal`} sub={`at ${data.siteName}`} accent />
        <Stat label="On-hand value" value={`$${data.fuelOnHandCost.toLocaleString()}`} sub={`@ $${data.fuelCost}/gal`} />
        <Stat label="6-mo usage" value={`${totalG.toLocaleString()} gal`} sub="all equipment" />
        <Stat label="6-mo fuel cost" value={`$${totalCost.toLocaleString()}`} sub={`≈ $${data.fuelCost.toLocaleString()}/gal avg`} />
      </div>

      <Card>
        <CardTitle
          title="Monthly fuel usage & cost"
          sub="Gallons consumed and spend across the fleet, by month"
          right={
            <div className="flex gap-1 rounded-lg border border-stone-200 p-1">
              {(["gallons", "cost"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setMetric(v)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold capitalize ${
                    metric === v ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          }
        />
        <div className="flex h-48 items-end gap-3 sm:gap-5">
          {fuel.map((m) => {
            const val = metric === "gallons" ? m.gallons : m.cost;
            const max = metric === "gallons" ? maxG : Math.max(...fuel.map((x) => x.cost));
            return (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-stone-700">
                  {metric === "gallons" ? m.gallons.toLocaleString() : `$${Math.round(m.cost / 1000)}k`}
                </span>
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-green-800 to-green-500 transition-all"
                  style={{ height: `${Math.max(6, (val / max) * 100)}%` }}
                />
                <span className="text-xs text-stone-500">{m.month}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-500">
          <span className="rounded-full bg-stone-100 px-3 py-1">Tractors/loaders: 42%</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">Pickups/trucks: 38%</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">Harvest: 12%</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">Feed wagons: 8%</span>
        </div>
        <p className="mt-3 text-xs text-stone-400">Month-to-month spend trends feed directly into per-category cost reporting. Sample data.</p>
      </Card>
    </div>
  );
}
