import { useState } from "react";
import { Badge, Card, CardTitle, ProgressBar } from "~/components/ui";
import {
  FEEDLOT_NUTRITION,
  GRASS_FOR_ANIMAL,
  GRAZING_SYSTEM_COMPARISON,
  GRAZING_SYSTEMS,
  REGION,
  REGIONAL_BASICS,
} from "~/data/sample";
import type { DemoSiteData } from "~/data/demoSites";

const condTone = (c: string) =>
  c === "Excellent" ? "green" : c === "Good" ? "blue" : c === "Fair" ? "amber" : "red";

export function PastureModule({ data }: { data: DemoSiteData }) {
  const [mode, setMode] = useState<"assignments" | "intel">("intel");
  const pastures = data.pastures;
  const grazedCount = pastures.filter((p) => p.restDays === 0).length;

  return (
    <div className="space-y-5">
      {/* Mode switch */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setMode("assignments")}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
            mode === "assignments" ? "border-green-700 bg-green-800 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
          }`}
        >
          🌿 Pastures & grazing activity
        </button>
        <button
          onClick={() => setMode("intel")}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
            mode === "intel" ? "border-amber-500 bg-amber-400 text-green-950" : "border-stone-300 bg-white text-stone-700 hover:bg-amber-50"
          }`}
        >
          🧭 Regional / Forage Intelligence <Badge tone="amber">Highlight</Badge>
        </button>
      </div>

      {mode === "assignments" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <Badge tone="blue">{pastures.length} pastures shown</Badge>
            <Badge tone="green">{grazedCount} currently being grazed</Badge>
            <Badge tone="amber">{pastures.filter((p) => p.forageCondition === "Fair" || p.forageCondition === "Overgrazed").length} need attention</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pastures.map((p) => {
              const system = p.species.includes("Feedlot") ? "feedlot" : p.restDays > 0 ? "rotational" : "continuous";
              const sys = GRAZING_SYSTEMS.find((g) => g.id === system)!;
              return (
                <Card key={p.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-stone-900">{p.name}</h3>
                      <p className="text-xs text-stone-500">{p.siteName} · {p.acres} acres</p>
                    </div>
                    <Badge tone={condTone(p.forageCondition)}>{p.forageCondition}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">Forage: {p.species}</p>
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-xs text-stone-500">
                      <span>Utilization</span>
                      <span>{p.utilization}%</span>
                    </div>
                    <ProgressBar value={p.utilization} max={100} color={p.utilization > 85 ? "#b91c1c" : "#5a7d3a"} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-stone-600">
                    <span>Rest since grazed</span>
                    <span className="font-semibold">{p.restDays === 0 ? "Grazing now" : `${p.restDays} days`}</span>
                  </div>
                  <div className="mt-2">
                    <Badge tone="stone">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: sys.color }} />
                      {sys.name}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-stone-400">Rotational, continuous, and feedlot pastures coexist in one view — filter by site above. Sample data.</p>
        </>
      ) : (
        <RegionalIntelligence />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Regional / Forage Intelligence — sample for TEXAS. Highlighted differentiator.
 * ------------------------------------------------------------------------- */
function RegionalIntelligence() {
  const [section, setSection] = useState<"basics" | "animal" | "compare" | "feedlot">("basics");

  const sections = [
    { key: "basics", label: "Regional basics" },
    { key: "animal", label: "Grass ↔ animal" },
    { key: "compare", label: "Grazing systems" },
    { key: "feedlot", label: "Feedlot rations" },
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="border-amber-300 bg-gradient-to-br from-amber-50 via-white to-green-50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Regional pasture & forage intelligence</p>
            <h3 className="mt-1 text-2xl font-bold text-stone-900">
              Sample for {REGION.state} 🧭
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">{REGION.climate}</p>
          </div>
          <Badge tone="amber">{REGION.note}</Badge>
        </div>
        <p className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-stone-700">
          {sections.find((s) => s.key === section)!.label} — tailored recommendations for the {REGION.state} growing region, matched to your operation's species and grazing system.
        </p>
      </Card>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              section === s.key ? "border-green-700 bg-green-800 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-green-50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Render active section */}
      <div>
        {section === "basics" && (
          <div className="grid gap-4 lg:grid-cols-3">
            {REGIONAL_BASICS.map((b) => (
              <Card key={b.title}>
                <h3 className="font-semibold text-stone-900">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{b.body}</p>
              </Card>
            ))}
          </div>
        )}

        {section === "animal" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {GRASS_FOR_ANIMAL.map((a) => (
              <Card key={a.species}>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-stone-900">{a.species}</h3>
                  {a.species === "Horses" && <Badge tone="red">fescue caution</Badge>}
                </div>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-green-700">Best grasses: {a.best}</p>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{a.body}</p>
              </Card>
            ))}
          </div>
        )}

        {section === "compare" && (
          <div className="grid gap-4 lg:grid-cols-3">
            {GRAZING_SYSTEM_COMPARISON.map((g) => (
              <Card key={g.name}>
                <h3 className="font-bold text-stone-900">{g.name}</h3>
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Strengths</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-stone-600">
                    {g.pros.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Trade-offs</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-stone-600">
                    {g.cons.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <p className="mt-3 rounded-lg bg-stone-100 p-2.5 text-xs text-stone-700">{g.best}</p>
              </Card>
            ))}
          </div>
        )}

        {section === "feedlot" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h3 className="font-bold text-stone-900">{FEEDLOT_NUTRITION[0].title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{FEEDLOT_NUTRITION[0].body}</p>
              <h3 className="mt-6 font-bold text-stone-900">{FEEDLOT_NUTRITION[2].title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{FEEDLOT_NUTRITION[2].body}</p>
            </Card>
            <Card>
              <h3 className="font-bold text-stone-900">{FEEDLOT_NUTRITION[1].title}</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                      {FEEDLOT_NUTRITION[1].rows[0].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {FEEDLOT_NUTRITION[1].rows.slice(1).map((row) => (
                      <tr key={row[0]} className="text-stone-700">
                        {row.map((c, i) => <td key={i} className="py-2.5 pr-3">{i === 0 ? <span className="font-semibold">{c}</span> : c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
