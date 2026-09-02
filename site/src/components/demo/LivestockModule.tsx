import { useState } from "react";
import { Badge, Card, CardTitle, ProgressBar, Stat } from "~/components/ui";
import type { Species } from "~/data/sample";
import type { DemoSiteData } from "~/data/demoSites";

export function LivestockModule({ data }: { data: DemoSiteData }) {
  const firstPresent = data.livestock.find((s) => s.head > 0) ?? data.livestock[0];
  const [openSpecKey, setOpenSpecKey] = useState<Species["key"]>(firstPresent ? firstPresent.key : "cattle");
  const openKey = data.livestock.some((s) => s.key === openSpecKey && s.head > 0) ? openSpecKey : firstPresent.key;
  const detail = data.livestock.find((s) => s.key === openKey)!;
  const maxHead = Math.max(...data.livestock.map((s) => s.head));
  const totalHead = data.totalHead;
  const present = data.livestock.filter((s) => s.head > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total head" value={totalHead.toLocaleString()} sub={data.siteName} />
        <Stat label="Animal units (AU)" value={data.totalAu.toLocaleString()} sub="grazing-equivalent total" accent />
        <Stat label="Stocking rate" value={data.stockingRate} sub="across grazeable acres" />
        <Stat label="Species tracked" value={String(present.length)} sub="in inventory" />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* species breakdown with filter */}
        <Card className="lg:col-span-2">
          <CardTitle title="Inventory by species" sub="Click a row to inspect" />
          <ul className="divide-y divide-stone-100">
            {data.livestock.filter((s) => s.head > 0).map((s) => {
              const active = s.key === openKey;
              return (
                <button
                  key={s.key}
                  onClick={() => setOpenSpecKey(s.key)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition ${
                    active ? "bg-green-50" : "hover:bg-stone-50"
                  }`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-stone-800">{s.label}</p>
                    <div className="mt-1">
                      <ProgressBar value={s.head} max={maxHead} color={s.color} />
                    </div>
                  </div>
                  <span className="text-lg font-bold text-stone-800">{s.head.toLocaleString()}</span>
                </button>
              );
            })}
          </ul>
        </Card>

        {/* selected species detail */}
        <Card className="lg:col-span-3">
          <CardTitle title={`${detail.label} — herd snapshot`} sub={detail.note} />
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">Head</p>
              <p className="text-2xl font-bold">{detail.head.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">% of inventory</p>
              <p className="text-2xl font-bold">{Math.round((detail.head / totalHead) * 100)}%</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">Sample rows</p>
              <p className="text-2xl font-bold">{detail.head.toLocaleString()}</p>
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-4">Tag / ID</th>
                  <th className="py-2 pr-4">Class</th>
                  <th className="py-2 pr-4">Site</th>
                  <th className="py-2">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[
                  ["RMP-1001", "Cow", data.siteName, "green"],
                  ["RMP-1004", "Stocker", data.siteName, "green"],
                  ["RMP-1007", "Heifer", data.siteName, "amber"],
                  ["RMP-1012", "Bull", data.siteName, "green"],
                ].map((row) => (
                  <tr key={row[0]} className="text-stone-700">
                    <td className="py-2.5 pr-4 font-medium">{row[0]}</td>
                    <td className="py-2.5 pr-4">{row[1]}</td>
                    <td className="py-2.5 pr-4">{row[2]}</td>
                    <td className="py-2.5">
                      <Badge tone={row[3] as "green" | "amber"}>{row[3] === "green" ? "Healthy" : "Needs review"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-stone-400">
            Sample records only. The live product links each animal to health, treatment, and weight history.
          </p>
        </Card>
      </div>
    </div>
  );
}
