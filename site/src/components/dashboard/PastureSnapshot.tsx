import { Badge, Card, CardTitle, ProgressBar } from "~/components/ui";
import type { PastureData, PastureAssignment } from "~/types/pasture";

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);

function grazingProgress(a: PastureAssignment): { used: number; target: number; pct: number; left: number } {
  const target = a.target_grazing_days ?? 0;
  const used = target > 0 ? Math.max(0, daysBetween(a.assigned_at, todayStr())) : 0;
  const pct = target > 0 ? Math.min(100, Math.round((used / target) * 100)) : 100;
  const left = target > 0 ? target - used : 0;
  return { used, target, pct, left };
}

export function PastureSnapshot({ data }: { data: PastureData }) {
  const pastureById = new Map(data.pastures.map((p) => [p.id, p]));
  const active = data.assignments.filter((a) => !a.ended_at);
  const resting = data.pastures.filter((p) => p.status === "resting" || p.status === "idle");
  const actionsDue = active.filter((a) => {
    const t = a.target_grazing_days ?? 0;
    return t > 0 && daysBetween(a.assigned_at, todayStr()) >= t;
  });
  return (
    <Card>
      <CardTitle title="Pasture status" sub={`${active.length} grazed now · ${resting.length} resting · ${actionsDue.length} moves due`} />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="green">{active.length} currently grazed</Badge>
        <Badge tone="blue">{resting.length} resting / idle</Badge>
        {actionsDue.length > 0 && <Badge tone="amber">{actionsDue.length} rotation due</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {active.map((a) => {
          const pasture = pastureById.get(a.pasture_id);
          const prog = grazingProgress(a);
          const due = prog.target > 0 && prog.left <= 0;
          return (
            <div key={a.id} className={`rounded-xl border p-3 ${due ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-stone-800">{pasture?.name ?? `Pasture #${a.pasture_id}`}</p>
                  <p className="text-xs text-stone-500">
                    {a.herd_group_name ?? "Herd"} · {pasture?.size_acres ?? "—"} ac
                  </p>
                </div>
                {due ? (
                  <Badge tone="amber">Move due</Badge>
                ) : (
                  <Badge tone="green">{prog.left >= 0 ? `${prog.left}d of grazing left` : "over target"}</Badge>
                )}
              </div>
              {prog.target > 0 ? (
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-xs text-stone-500">
                    <span>Grazing — day {prog.used} of {prog.target}</span>
                    <span>rotate {addDays(a.assigned_at, prog.target)}</span>
                  </div>
                  <ProgressBar value={prog.used} max={prog.target} color={due ? "#d97706" : "#5a7d3a"} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-stone-500">Assigned {a.assigned_at} — no grazing target set.</p>
              )}
              {due && (
                <p className="mt-1.5 rounded-lg bg-amber-100/70 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  → Grazing target reached — rotate {a.herd_group_name ?? "herd"} off {pasture?.name ?? "this pasture"}
                </p>
              )}
            </div>
          );
        })}
        {active.length === 0 && (
          <p className="col-span-full rounded-xl border border-stone-100 bg-stone-50 p-4 text-sm text-stone-500">
            No active pasture assignments. Assign a herd to a pasture to start tracking grazing days.
          </p>
        )}
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Grazing days, rotation targets, and rest status come directly from your live pasture assignments and pasture records.
      </p>
    </Card>
  );
}
