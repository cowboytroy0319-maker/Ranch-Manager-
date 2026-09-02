import { Card, CardTitle, Stat } from "~/components/ui";
import type { DemoSiteData } from "~/data/demoSites";

export function CostsModule({ data }: { data: DemoSiteData }) {
  const sorted = [...data.costsYtd].sort((a, b) => b.ytd - a.ytd);
  const max = Math.max(...data.costsYtd.map((c) => c.ytd));
  const top = sorted[0];
  const fuelCat = data.costsYtd.find((c) => c.label === "Fuel");
  const fuelShare = fuelCat ? Math.round((fuelCat.ytd / data.totalYtd) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="YTD operating cost" value={`$${(data.totalYtd / 1000).toFixed(1)}k`} sub={`at ${data.siteName}`} accent />
        <Stat label="Top category" value={top.label} sub={`$${top.ytd.toLocaleString()}`} />
        <Stat label="Cost per animal unit" value={`$${data.costPerAu}`} sub="YTD, all categories" />
        <Stat label="Fuel share" value={`${fuelShare}%`} sub="of total spend" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle title="YTD cost by category" sub="Ranked · click to inspect (sample)" />
          <div className="space-y-3">
            {sorted.map((c, i) => (
              <div key={c.label} className="flex items-center gap-3">
                <span className="w-5 text-sm font-bold text-stone-400">{i + 1}</span>
                <span className="w-36 text-sm font-medium text-stone-700">{c.label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(c.ytd / max) * 100}%`, backgroundColor: c.color }} />
                </div>
                <span className="w-20 text-right text-sm font-semibold text-stone-800">${(c.ytd / 1000).toFixed(1)}k</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
            <span className="text-sm font-semibold text-green-900">Total (sample)</span>
            <span className="text-lg font-bold text-green-900">${(data.totalYtd / 1000).toFixed(1)}k</span>
          </div>
        </Card>

        <Card>
          <CardTitle title="What the demo shows" sub="Real cost reporting before the back-end exists" />
          <ul className="space-y-3 text-sm text-stone-600">
            <li>• Every cost category (feed, fuel, equipment, vet, insurance, supplies) tracked to the month and rolled into a YTD total.</li>
            <li>• Cost-per-animal-unit and category share give an instant read on where money goes.</li>
            <li>• In the live product these figures update in real time from fuel logs, feed purchases, and service entries.</li>
            <li>• Multi-site operators can split costs by site to see each location's true margin.</li>
          </ul>
          <p className="mt-4 text-xs text-stone-400">All dollar figures are illustrative sample data for the MVP demo.</p>
        </Card>
      </div>
    </div>
  );
}
