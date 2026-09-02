import { useState } from "react";
import { Badge } from "~/components/ui";
import {
  assetStatus,
  meterLabel,
  nextDueLabel,
  type EquipmentData,
} from "~/types/equipment";
import { lowStockItems, type FeedData } from "~/types/feed";
import type { LivestockData } from "~/types/livestock";
import type { PastureData } from "~/types/pasture";

export function morningDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export type Priority = {
  id: string;
  tone: "red" | "amber" | "blue";
  category: string;
  title: string;
  detail: string;
};

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysUntil = (iso: string): number =>
  Math.round((new Date(iso + "T00:00:00").getTime() - new Date(todayStr() + "T00:00:00").getTime()) / 86400000);

interface BriefingInput {
  livestock: LivestockData;
  feed: FeedData;
  pasture: PastureData;
  equipment: EquipmentData;
}

/** Derive genuine "today's" priorities exclusively from live data. Nothing is
 * fabricated: an item only appears if the underlying record points to a real,
 * dated, actionable need. If nothing qualifies, the caller shows the calm
 * all-clear state. */
export function derivePriorities(d: BriefingInput): Priority[] {
  const today = todayStr();
  const out: Priority[] = [];
  const { equipment, maintenance } = d.equipment;

  // 1. Equipment: out-of-service first, then maintenance due (open + next-due reached).
  for (const eq of equipment) {
    const status = assetStatus(eq, maintenance);
    if (status === "out-of-service") {
      out.push({
        id: `eq-down-${eq.id}`,
        tone: "red",
        category: "Equipment",
        title: `${eq.name} is out of service`,
        detail: `${eq.category} · down — awaiting parts / repair`,
      });
    } else if (status === "maintenance-due") {
      out.push({
        id: `eq-due-${eq.id}`,
        tone: "amber",
        category: "Maintenance",
        title: `Service due on ${eq.name}`,
        detail: `${meterLabel(eq)} · ${nextDueLabel(eq, maintenance) ?? "next service due"}`,
      });
    }
  }

  // 2. Pasture rotation: active assignments whose grazing target is elapsed (or near).
  const pastureById = new Map(d.pasture.pastures.map((p) => [p.id, p]));
  for (const a of d.pasture.assignments) {
    if (a.ended_at) continue; // not active
    if (!a.assigned_at) continue;
    const target = a.target_grazing_days ?? 0;
    const dueDate = addDays(a.assigned_at, target);
    const left = daysUntil(dueDate);
    const pname = pastureById.get(a.pasture_id)?.name ?? `Pasture #${a.pasture_id}`;
    if (left <= 0) {
      out.push({
        id: `pasture-${a.id}`,
        tone: "amber",
        category: "Pasture move",
        title: `Rotate ${pname}`,
        detail: `${a.herd_group_name ?? "Herd"} grazing target (${target || "—"} days) reached ${dueDate}`,
      });
    }
  }

  // 3. Health events: overdue next_due → red, upcoming within a few days → blue.
  const animalById = new Map(d.livestock.animals.map((a) => [a.id, a]));
  for (const e of d.livestock.events) {
    if (!e.next_due) continue;
    const left = daysUntil(e.next_due);
    if (left <= 0) {
      out.push({
        id: `health-${e.id}`,
        tone: "red",
        category: "Livestock health",
        title: `${animalById.get(e.animal_id)?.name ?? `Animal #${e.animal_id}`} — ${e.type} overdue`,
        detail: `Follow-up ${e.type} due ${e.next_due}`,
      });
    } else if (left <= 3) {
      out.push({
        id: `health-${e.id}`,
        tone: "blue",
        category: "Livestock health",
        title: `${animalById.get(e.animal_id)?.name ?? `Animal #${e.animal_id}`} — ${e.type}`,
        detail: `Next ${e.type} due ${e.next_due}`,
      });
    }
  }

  // 4. Low stock (hay + feed): anything at/below threshold.
  for (const ls of lowStockItems(d.feed.hay, d.feed.feed)) {
    const id = ls.kind === "hay" ? `hay-${(ls.item as { id: number }).id}` : `feed-${(ls.item as { id: number }).id}`;
    const name =
      ls.kind === "hay"
        ? ((ls.item as { feed_type: string }).feed_type[0].toUpperCase() + (ls.item as { feed_type: string }).feed_type.slice(1) + " hay")
        : (ls.item as { name: string }).name;
    const qty = ls.kind === "hay"
      ? `${(ls.item as { quantity: number; unit: string }).quantity} ${(ls.item as { unit: string }).unit}`
      : `${(ls.item as { quantity: number; unit: string }).quantity} ${(ls.item as { unit: string }).unit}`;
    out.push({
      id,
      tone: "amber",
      category: "Low stock",
      title: `Reorder: ${name}`,
      detail: `Only ${qty} left — at or below reorder point`,
    });
  }

  // Sort: red → amber → blue, then by soonest.
  const rank = { red: 0, amber: 1, blue: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.title < b.title ? -1 : 1)).slice(0, 6);
}

const toneStyles: Record<Priority["tone"], { bar: string; label: string; chip: "red" | "amber" | "blue" }> = {
  red: { bar: "bg-red-500", label: "text-red-700", chip: "red" },
  amber: { bar: "bg-amber-400", label: "text-amber-700", chip: "amber" },
  blue: { bar: "bg-sky-400", label: "text-sky-700", chip: "blue" },
};
const toneText: Record<Priority["tone"], string> = {
  red: "Act now",
  amber: "Due soon",
  blue: "Upcoming",
};

export function MorningBriefing({ data }: { data: BriefingInput }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const all = derivePriorities(data);
  const open = all.filter((p) => !done.has(p.id));
  const reds = open.filter((p) => p.tone === "red").length;
  const ambers = open.filter((p) => p.tone === "amber").length;
  return (
    <section className="rounded-2xl border border-green-800/20 bg-gradient-to-br from-green-50 via-white to-green-50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow !text-green-800">Good morning — {morningDate()}</p>
          <h2 className="mt-1 text-2xl font-bold text-stone-900 sm:text-3xl">Here's what needs you today.</h2>
          <p className="mt-1 text-sm text-stone-600">
            {reds > 0
              ? `${reds} item${reds === 1 ? "" : "s"} overdue or need action now · ${ambers} due soon.`
              : ambers > 0
              ? `${ambers} items due soon; nothing overdue. A calm morning.`
              : "Nothing overdue and nothing due today."}{" "}
            The day's priorities are listed first — handle these before digging into forms.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge tone={reds > 0 ? "red" : "green"}>{reds > 0 ? `${reds} need action now` : "Nothing overdue"}</Badge>
          <Badge tone="stone">{open.length} of {all.length} open</Badge>
        </div>
      </div>
      <ul className="mt-5 grid gap-2.5 md:grid-cols-2">
        {open.map((p) => {
          const s = toneStyles[p.tone];
          return (
            <li key={p.id} className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.bar}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-stone-900">{p.title}</p>
                  <Badge tone={s.chip}>{toneText[p.tone]}</Badge>
                </div>
                <p className="mt-0.5 text-left text-xs text-stone-500">
                  <span className="font-medium text-stone-600">{p.category}</span> · {p.detail}
                </p>
              </div>
              <button
                onClick={() => toggle(p.id)}
                className="mt-0.5 shrink-0 rounded-lg border border-green-700 bg-green-700 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-green-800"
                title="Mark done"
              >
                Done
              </button>
            </li>
          );
        })}
        {open.length === 0 && (
          <li className="col-span-full rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
            ✓ Everything's handled for today. Nice work — enjoy the morning ride.
          </li>
        )}
      </ul>
      <p className="mt-3 text-xs text-stone-400">
        Priorities come straight from your live records: overdue maintenance, pasture rotations, upcoming vet work, and low-stock feed &amp; hay. Nothing is invented — if it's clear, this stays quiet.
      </p>
    </section>
  );
}
