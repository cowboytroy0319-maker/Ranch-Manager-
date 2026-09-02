import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import {
  CATEGORY_LABEL,
  assetStatus,
  meterLabel,
  nextDueLabel,
  type EquipmentData,
} from "~/types/equipment";

export function EquipmentSnapshot({ data }: { data: EquipmentData }) {
  const { equipment, maintenance } = data;
  const inService = equipment.filter((e) => assetStatus(e, maintenance) === "in-service").length;
  const due = equipment.filter((e) => assetStatus(e, maintenance) === "maintenance-due").length;
  const down = equipment.filter((e) => assetStatus(e, maintenance) === "out-of-service").length;
  return (
    <Card>
      <CardTitle title="Equipment status" sub={`${inService} in service · ${due} due for service · ${down} down`} />
      <div className="grid grid-cols-3 gap-4">
        <Stat label="In service" value={String(inService)} sub="ready to run" />
        <Stat label="Need service" value={String(due)} sub="due by hours / miles / date" accent={due > 0} />
        <Stat label="Down" value={String(down)} sub="awaiting parts" accent={down > 0} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-3">Unit</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3 text-right">Hours / miles</th>
              <th className="py-2 pr-3">Next service</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {equipment.map((e) => {
              const st = assetStatus(e, maintenance);
              const label = st === "out-of-service" ? "Down" : st === "maintenance-due" ? "Maintenance due" : "In service";
              const tone = (st === "out-of-service" ? "red" : st === "maintenance-due" ? "amber" : "green") as "red" | "amber" | "green";
              return (
                <tr key={e.id} className={st !== "in-service" ? "bg-amber-50/40" : ""}>
                  <td className="py-2.5 pr-3 font-medium text-stone-800">{e.name}</td>
                  <td className="py-2.5 pr-3 text-stone-600">{CATEGORY_LABEL[e.category] ?? e.category}</td>
                  <td className="py-2.5 pr-3 text-right text-stone-600">{meterLabel(e)}</td>
                  <td className="py-2.5 pr-3 text-stone-600">{nextDueLabel(e, maintenance) ?? "—"}</td>
                  <td className="py-2.5">
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {equipment.length === 0 && (
          <p className="py-4 text-sm text-stone-500">No equipment on record.</p>
        )}
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Units are flagged when service is due by hours, miles, or date, or when an open repair or out-of-service status is set — all from your live maintenance records.
      </p>
    </Card>
  );
}
