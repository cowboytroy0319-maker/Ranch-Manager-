import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import type { DemoSiteData } from "~/data/demoSites";

type Status = "In service" | "Maintenance due" | "Down";
const toneFor = (s: Status) => (s === "Down" ? "red" : s === "Maintenance due" ? "amber" : "green");

export function EquipmentModule({ data }: { data: DemoSiteData }) {
  const [list, setList] = useState(data.equipment.map((e) => ({ ...e })));

  const markDone = (id: string) =>
    setList((ls) => ls.map((e) => (e.id === id ? { ...e, status: e.status === "Maintenance due" ? "In service" : "Maintenance due", nextService: e.status === "Maintenance due" ? "Scheduled Dec 2026" : "Maintenance due" } : e)));

  const inService = list.filter((e) => e.status === "In service").length;
  const due = list.filter((e) => e.status !== "In service").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total units" value={String(list.length)} sub="tractors, pickups, hay tools" />
        <Stat label="In service" value={String(inService)} sub="ready to run" />
        <Stat label="Need maintenance" value={String(due)} sub="service or repair" />
        <Stat label="Avg fleet age" value="4.2 yrs" sub="sample fleet" />
      </div>

      <Card>
        <CardTitle title="Equipment & maintenance" sub="Click 'Mark done' on a maintenance-due unit to simulate logging service" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-4">Unit</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4 text-right">Hours</th>
                <th className="py-2 pr-4">Next service</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {list.map((e) => (
                <tr key={e.id} className={e.status !== "In service" ? "bg-amber-50/40" : ""}>
                  <td className="py-3 pr-4 font-medium text-stone-800">{e.name}</td>
                  <td className="py-3 pr-4 text-stone-600">{e.category}</td>
                  <td className="py-3 pr-4 text-right text-stone-600">{e.hours.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-stone-600">{e.nextService}</td>
                  <td className="py-3 pr-4"><Badge tone={toneFor(e.status)}>{e.status}</Badge></td>
                  <td className="py-3">
                    {e.status !== "Down" ? (
                      <button
                        onClick={() => markDone(e.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          e.status === "Maintenance due"
                            ? "bg-green-700 text-white hover:bg-green-800"
                            : "border border-stone-300 text-stone-600 hover:bg-stone-50"
                        }`}
                      >
                        {e.status === "Maintenance due" ? "✓ Mark done" : "Mark due"}
                      </button>
                    ) : (
                      <Badge tone="red">Parts on order</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-stone-400">Maintenance-due units roll up into overview counts in real time. Sample data.</p>
      </Card>
    </div>
  );
}
