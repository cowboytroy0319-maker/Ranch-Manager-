import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { UPCOMING_WINDOW_DAYS, type LivestockData, SPECIES } from "~/types/livestock";

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const SPECIES_COLOR: Record<string, string> = {
  cattle: "#5a7d3a",
  horse: "#8a5a2b",
  goat: "#7b8fa3",
  sheep: "#b98a3a",
};

export function LivestockSnapshot({ data }: { data: LivestockData }) {
  const animals = data.animals;
  const active = animals.filter((a) => a.status === "active");

  // Distinct active animals with a health follow-up due within the coming
  // window (next_due is what drives "needing attention").
  const needsAttention = new Set<number>();
  for (const e of data.events) {
    if (!e.next_due) continue;
    if (e.next_due <= todayStr() || e.next_due <= addDays(todayStr(), UPCOMING_WINDOW_DAYS)) {
      needsAttention.add(e.animal_id);
    }
  }
  const attentionCount = active.filter((a) => needsAttention.has(a.id)).length;
  const sold = animals.filter((a) => a.status === "sold").length;
  const deceased = animals.filter((a) => a.status === "deceased").length;

  const bySpecies = SPECIES.map((s) => {
    const list = active.filter((a) => a.species === s);
    return {
      species: s,
      head: list.length,
      attention: list.filter((a) => needsAttention.has(a.id)).length,
    };
  }).filter((r) => r.head > 0);
  const maxHead = Math.max(1, ...bySpecies.map((r) => r.head));

  return (
    <Card>
      <CardTitle title="Livestock snapshot" sub="Counts by species · health follow-ups on record" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active head" value={active.length.toLocaleString()} sub={`${animals.length} on record`} accent />
        <Stat label="Needing attention" value={String(attentionCount)} sub="follow-up due in next 30d" accent={attentionCount > 0} />
        <Stat label="Sold this year" value={String(sold)} sub="on record" />
        <Stat label="Deceased" value={String(deceased)} sub="on record" />
      </div>
      <div className="mt-4 space-y-3">
        {bySpecies.map((r) => (
          <div key={r.species} className="flex items-center gap-3">
            <span className="w-14 text-xs font-medium capitalize text-stone-600">{r.species}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.head / maxHead) * 100}%`, backgroundColor: SPECIES_COLOR[r.species] }}
              />
            </div>
            <span className="w-14 text-right text-xs font-semibold text-stone-700">{r.head.toLocaleString()}</span>
          </div>
        ))}
        {bySpecies.length === 0 && (
          <p className="text-sm text-stone-500">No livestock on record yet.</p>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-3">Species</th>
              <th className="py-2 pr-3 text-center">Active</th>
              <th className="py-2 pr-3 text-center">On record</th>
              <th className="py-2 text-center">Follow-ups</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {bySpecies.map((r) => (
              <tr key={r.species} className="text-stone-700">
                <td className="py-2.5 pr-3 font-medium capitalize text-stone-800">{r.species}</td>
                <td className="py-2.5 pr-3 text-center">{r.head}</td>
                <td className="py-2.5 pr-3 text-center">
                  {animals.filter((a) => a.species === r.species).length}
                </td>
                <td className="py-2.5 text-center">
                  {r.attention > 0 ? (
                    <Badge tone="amber">{r.attention} need review</Badge>
                  ) : (
                    <Badge tone="green">All clear</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Head counts and health follow-ups come straight from your live livestock records — nothing is rolled-up or estimated.
      </p>
      <Link to="/livestock" className="mt-2 inline-block text-sm font-semibold text-green-700 transition hover:text-green-900">
        Manage livestock records →
      </Link>
    </Card>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
