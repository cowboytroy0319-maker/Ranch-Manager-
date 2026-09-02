import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import type { LivestockData } from "~/types/livestock";
import type { PastureData } from "~/types/pasture";
import type { EquipmentData } from "~/types/equipment";

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Only surface genuinely upcoming items within this horizon (inclusive of today).
const HORIZON_DAYS = 120;

type Kind = "Maintenance" | "Pasture move" | "Health";
const KIND_TONE: Record<Kind, "blue" | "amber" | "green" | "red" | "stone"> = {
  Maintenance: "blue",
  "Pasture move": "amber",
  Health: "green",
};

type CalItem = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  site: string;
  kind: Kind;
};

function buildItems(data: { livestock: LivestockData; pasture: PastureData; equipment: EquipmentData }): CalItem[] {
  const today = todayStr();
  const out: CalItem[] = [];
  const horizon = addDays(today, HORIZON_DAYS);
  const inHorizon = (d: string) => d >= today && d <= horizon;

  const animalById = new Map(data.livestock.animals.map((a) => [a.id, a]));
  const pastureById = new Map(data.pasture.pastures.map((p) => [p.id, p]));
  const equipById = new Map(data.equipment.equipment.map((e) => [e.id, e]));

  // Maintenance next-due dates
  for (const m of data.equipment.maintenance) {
    if (m.next_due_date && inHorizon(m.next_due_date)) {
      out.push({
        id: `maint-${m.id}`,
        date: m.next_due_date,
        title: `Service due — ${equipById.get(m.equipment_id)?.name ?? `Equipment #${m.equipment_id}`}`,
        site: m.service_type.replace("-", " ") + (m.vendor ? ` · ${m.vendor}` : ""),
        kind: "Maintenance" as Kind,
      });
    }
  }

  // Pasture rotation end dates (active assignments, target elapsed date)
  for (const a of data.pasture.assignments) {
    if (a.ended_at || !a.assigned_at) continue;
    const target = a.target_grazing_days;
    if (!target || target <= 0) continue;
    const endDate = addDays(a.assigned_at, target);
    if (inHorizon(endDate)) {
      out.push({
        id: `pasture-${a.id}`,
        date: endDate,
        title: `Rotate ${pastureById.get(a.pasture_id)?.name ?? `Pasture #${a.pasture_id}`}`,
        site: `${a.herd_group_name ?? "Herd"} · ${target}-day grazing plan`,
        kind: "Pasture move" as Kind,
      });
    }
  }

  // Health follow-ups (next_due)
  for (const e of data.livestock.events) {
    if (e.next_due && inHorizon(e.next_due)) {
      out.push({
        id: `health-${e.id}`,
        date: e.next_due,
        title: `${animalById.get(e.animal_id)?.name ?? `Animal #${e.animal_id}`} — ${e.type}`,
        site: e.description ?? `follow-up ${e.type}`,
        kind: "Health" as Kind,
      });
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const MONTH_YEAR = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function CalendarSnapshot({ data }: { data: { livestock: LivestockData; pasture: PastureData; equipment: EquipmentData } }) {
  const [showAll, setShowAll] = useState(false);
  const items = buildItems(data);
  const visible = showAll ? items : items.slice(0, 6);
  const ns = (n: number) => (n === 1 ? "event" : "events");
  const byKind = (k: Kind) => items.filter((c) => c.kind === k).length;

  const dateParts = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return { mon: MONTH_YEAR, day: d };
  };

  return (
    <Card>
      <CardTitle
        title="Upcoming calendar"
        sub={`${MONTH_YEAR} · maintenance · pasture rotations · vet follow-ups`}
        right={<Badge tone="stone">{items.length} coming up</Badge>}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Maintenance" value={String(byKind("Maintenance"))} sub="next service dates" />
        <Stat label="Pasture moves" value={String(byKind("Pasture move"))} sub="grazing targets" />
        <Stat label="Health / vet" value={String(byKind("Health"))} sub="follow-ups due" />
        <Stat label="Next 120 days" value={String(items.length)} sub="total on the board" />
      </div>
      {items.length > 0 ? (
        <ul className="mt-4 divide-y divide-stone-100">
          {visible.map((c) => {
            const dp = dateParts(c.date);
            return (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-green-50 py-1.5">
                  <span className="text-[10px] font-semibold uppercase text-green-700">{MONTH_YEAR.slice(0, 3)}</span>
                  <span className="text-sm font-bold text-green-900">{dp.day}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800" title={c.title}>{c.title}</p>
                  <p className="text-xs text-stone-500">{c.date} · {c.site}</p>
                </div>
                <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-4 text-sm text-stone-500">
          Nothing dated is coming up in the next {HORIZON_DAYS} days. New maintenance, pasture rotations, and vet follow-ups will land here automatically.
        </p>
      )}
      {items.length > 6 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-3 w-full rounded-lg border border-stone-300 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
        >
          {showAll ? `Show fewer` : `Show all ${items.length} ${ns(items.length)} ↑`}
        </button>
      )}
      <p className="mt-2 text-xs text-stone-400">
        Every date here comes straight from your live maintenance, pasture, and health records — nothing is pre-filled or estimated.
      </p>
    </Card>
  );
}
