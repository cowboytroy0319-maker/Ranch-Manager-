import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import {
  AnimalDetailModal,
  AnimalFormModal,
  HealthEventFormModal,
  ageLabel,
} from "~/components/livestock/LivestockModals";
import { getLivestockData } from "~/server/livestock";
import {
  ANIMAL_STATUSES,
  SEXES,
  SPECIES,
  UPCOMING_WINDOW_DAYS,
  type Animal,
  type Sex,
  type Species,
} from "~/types/livestock";

export const Route = createFileRoute("/livestock")({
  loader: () => getLivestockData(),
  component: LivestockPage,
});

const speciesEmoji: Record<Species, string> = {
  cattle: "🐄",
  horse: "🐎",
  goat: "🐐",
  sheep: "🐑",
};

const statusTone: Record<string, "green" | "amber" | "stone" | "red"> = {
  active: "green",
  pending: "amber",
  sold: "stone",
  deceased: "red",
  culled: "stone",
  archived: "stone",
};

const typeTone: Record<string, "green" | "amber" | "blue" | "red" | "stone"> = {
  vaccination: "green",
  treatment: "amber",
  inspection: "blue",
  injury: "red",
  other: "stone",
};

function LivestockPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  const [speciesFilter, setSpeciesFilter] = useState<Species | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sexFilter, setSexFilter] = useState<Sex | "all">("all");
  const [breedFilter, setBreedFilter] = useState<string>("all");
  const [pastureFilter, setPastureFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [eventFor, setEventFor] = useState<Animal | null>(null);

  const byId = useMemo(() => new Map(data.animals.map((a) => [a.id, a])), [data.animals]);

  const counts = useMemo(() => {
    const species: Record<string, { active: number; total: number }> = {};
    const status: Record<string, number> = {};
    for (const s of SPECIES) species[s] = { active: 0, total: 0 };
    for (const a of data.animals) {
      species[a.species] = species[a.species] ?? { active: 0, total: 0 };
      species[a.species].total += 1;
      status[a.status] = (status[a.status] ?? 0) + 1;
      if (a.status === "active") species[a.species].active += 1;
    }
    return { species, status };
  }, [data.animals]);

  const activeTotal = counts.status.active ?? 0;

  const pastures = useMemo(
    () => [...new Set(data.animals.map((a) => a.pasture).filter((p): p is string => Boolean(p)))].sort(),
    [data.animals]
  );

  const breeds = useMemo(
    () => [...new Set(data.animals.map((a) => a.breed).filter((b): b is string => Boolean(b)))].sort(),
    [data.animals]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.animals.filter((a) => {
      if (speciesFilter !== "all" && a.species !== speciesFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (sexFilter !== "all" && a.sex !== sexFilter) return false;
      if (breedFilter !== "all" && a.breed !== breedFilter) return false;
      if (pastureFilter !== "all" && a.pasture !== pastureFilter) return false;
      if (!q) return true;
      return [a.name, a.tag_number, String(a.id), a.breed, a.pasture, a.notes, a.herd_group_name]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [data.animals, speciesFilter, statusFilter, sexFilter, breedFilter, pastureFilter, query]);

  const upcoming = useMemo(() => {
    const cutoff = new Date(Date.now() + UPCOMING_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    return data.events
      .filter((e) => e.next_due && e.next_due <= cutoff)
      .sort((a, b) => (a.next_due! < b.next_due! ? -1 : 1))
      .slice(0, 10)
      .map((e) => ({
        ...e,
        animal: byId.get(e.animal_id),
        overdue: e.next_due! < todayStr,
      }));
  }, [data.events, byId]);

  const detail = detailId != null ? byId.get(detailId) ?? null : null;
  const detailEvents = detail
    ? data.events.filter((e) => e.animal_id === detail.id)
    : [];

  // ------------------------------------------------------------------ states
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🚜 Database not configured"
            sub="Livestock records persist to Postgres — no connection string is set in this environment."
          />
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-stone-700">
            <li>
              Set <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to a Postgres
              connection string.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:migrate</code> to create the
              livestock tables.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> to load the demo
              operation (12 cattle, 4 horses, 8 goats, 6 sheep + health events).
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-500">
            Meanwhile, the <Link to="/demo" className="font-semibold text-green-700 hover:text-green-900">interactive demo</Link>{" "}
            shows the same workflows with sample data.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
            <Link to="/demo" className="btn-primary !px-4 !py-2 text-sm">Open demo</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.error) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-red-300 bg-red-50">
          <CardTitle title="Database error" sub="The database is configured but the records could not be read." />
          <pre className="overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-red-800">{data.error}</pre>
          <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
        </Card>
      </Shell>
    );
  }

  // -------------------------------------------------------------------- page
  return (
    <Shell>
      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="On the ranch" value={activeTotal.toLocaleString()} sub="active head" accent />
        {SPECIES.map((s) => (
          <Stat
            key={s}
            label={`${speciesEmoji[s]} ${s}`}
            value={counts.species[s].active.toLocaleString()}
            sub={`${counts.species[s].total} total`}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming health care — the "today" hook */}
        <Card className="lg:col-span-2">
          <CardTitle
            title="Upcoming health care"
            sub={`Next due within ${UPCOMING_WINDOW_DAYS} days (overdue first)`}
          />
          {upcoming.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
              Nothing due in the next {UPCOMING_WINDOW_DAYS} days. 🎉
            </p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((e) => (
                <button
                  key={e.id}
                  onClick={() => e.animal && setDetailId(e.animal.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-stone-100 px-3 py-2.5 text-left transition hover:border-green-700/30 hover:bg-green-50/50"
                >
                  <span className={`w-20 shrink-0 text-xs font-semibold ${e.overdue ? "text-red-600" : "text-amber-700"}`}>
                    {e.overdue ? "Overdue" : e.next_due}
                  </span>
                  <span className="w-32 shrink-0 truncate text-sm font-medium text-stone-800">
                    {e.animal ? e.animal.name : `#${e.animal_id}`}
                    {e.animal?.tag_number && <span className="ml-1 text-xs text-stone-400">{e.animal.tag_number}</span>}
                  </span>
                  <Badge tone={typeTone[e.type] ?? "stone"}>{e.type}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-stone-600">{e.description ?? "—"}</span>
                  {e.animal?.pasture && (
                    <span className="hidden shrink-0 text-xs text-stone-400 sm:inline">{e.animal.pasture}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Status mix */}
        <Card>
          <CardTitle title="Herd status" sub="All records by status" />
          <div className="space-y-3">
            {ANIMAL_STATUSES.map((s) => (
              <div key={s} className="flex items-center justify-between gap-3">
                <Badge tone={statusTone[s]}>{s[0].toUpperCase() + s.slice(1)}</Badge>
                <span className="text-sm font-semibold text-stone-700">{counts.status[s] ?? 0}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-400">
            {data.groups.length} herd groups · {pastures.length} pastures · {data.events.length} health events on record
          </p>
        </Card>
      </div>

      {/* Toolbar */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="All" active={speciesFilter === "all"} onClick={() => setSpeciesFilter("all")} count={activeTotal} />
            {SPECIES.map((s) => (
              <FilterChip
                key={s}
                label={`${speciesEmoji[s]} ${s}`}
                active={speciesFilter === s}
                onClick={() => setSpeciesFilter(s)}
                count={counts.species[s].active}
              />
            ))}
          </div>
          <div className="ml-auto flex flex-1 flex-wrap items-center gap-2">
            <input
              className="w-full max-w-56 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20 sm:w-56"
              placeholder="Search name, tag, ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700 sm:w-auto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {ANIMAL_STATUSES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700 sm:w-auto"
              value={sexFilter}
              onChange={(e) => setSexFilter(e.target.value as Sex | "all")}
            >
              <option value="all">All sexes</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700 sm:w-auto"
              value={breedFilter}
              onChange={(e) => setBreedFilter(e.target.value)}
            >
              <option value="all">All breeds</option>
              {breeds.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700 sm:w-auto"
              value={pastureFilter}
              onChange={(e) => setPastureFilter(e.target.value)}
            >
              <option value="all">All locations</option>
              {pastures.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button onClick={() => setAddOpen(true)} className="btn-primary !px-4 !py-2 text-sm">
              + Add animal
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-4xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Tag / Name</th>
                <th className="py-2 pr-3">Species</th>
                <th className="py-2 pr-3">Sex</th>
                <th className="py-2 pr-3">Age</th>
                <th className="py-2 pr-3">Herd / Pasture</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Next due</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((a) => {
                const nextDue = data.events
                  .filter((e) => e.animal_id === a.id && e.next_due)
                  .sort((x, y) => (x.next_due! < y.next_due! ? -1 : 1))[0];
                return (
                  <tr
                    key={a.id}
                    onClick={() => setDetailId(a.id)}
                    className={`cursor-pointer transition hover:bg-green-50/50 ${a.status === "active" ? "" : "opacity-60"}`}
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-stone-900">{a.name}</span>
                      {a.tag_number && <span className="ml-2 text-xs text-stone-400">{a.tag_number}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-700">{speciesEmoji[a.species]} {a.species}</td>
                    <td className="py-2.5 pr-3 text-stone-600">{a.sex ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-stone-600">{a.birth_date ? ageLabel(a.birth_date) : "—"}</td>
                    <td className="py-2.5 pr-3 text-stone-600">
                      {a.herd_group_name ?? "—"}
                      {a.pasture && <span className="block text-xs text-stone-400">{a.pasture}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={statusTone[a.status] ?? "stone"}>{a.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">{nextDue?.next_due ?? "—"}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(a); }}
                        className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-stone-500">
                    {data.animals.length === 0
                      ? "No animals on record yet — add your first, or run `bun run db:seed` to load the demo operation."
                      : "No animals match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-stone-400">
          {filtered.length} of {data.animals.length} records · click a row for health history · live Postgres records
        </p>
      </Card>

      {/* Modals */}
      {detail && (
        <AnimalDetailModal
          animal={detail}
          events={detailEvents}
          onClose={() => setDetailId(null)}
          onEdit={() => { setEditing(detail); setDetailId(null); }}
          onAddEvent={() => { setEventFor(detail); setDetailId(null); }}
        />
      )}
      {addOpen || editing ? (
        <AnimalFormModal
          key={editing ? `edit-${editing.id}` : "add"}
          editing={editing}
          groups={data.groups}
          pastures={pastures}
          onClose={() => { setEditing(null); setAddOpen(false); }}
          onSaved={() => { setEditing(null); setAddOpen(false); refresh(); }}
        />
      ) : null}
      {eventFor && (
        <HealthEventFormModal
          animal={eventFor}
          onClose={() => setEventFor(null)}
          onSaved={() => { setEventFor(null); refresh(); }}
        />
      )}
    </Shell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-green-800 bg-green-800 text-white"
          : "border-stone-200 bg-white text-stone-600 hover:border-green-700/40 hover:text-green-800"
      }`}
    >
      {label} <span className={active ? "text-green-200" : "text-stone-400"}>{count}</span>
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-stone-100">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            <span className="hidden font-bold text-stone-900 sm:inline">Ranch Manager Pro</span>
          </Link>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            Livestock Records
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/feed" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Feed &amp; Hay
          </Link>
          <Link to="/pasture" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Pasture
          </Link>
          <Link to="/equipment" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Equipment
          </Link>
          <Link to="/employees" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Employees
          </Link>
          <Link to="/dashboard" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Daily Ops
          </Link>
          <Link to="/analytics" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Analytics
          </Link>
          <Link to="/demo" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 sm:inline">
            Demo modules
          </Link>
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">First real module · live database</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">Livestock Inventory &amp; Health</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Real records for the animals on the operation — scannable at the barn, updated from the saddle.
          </p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Livestock module (MVP)</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
