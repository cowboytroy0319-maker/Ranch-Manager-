import { useState } from "react";
import { Card, CardTitle, Badge } from "~/components/ui";
import {
  FORAGE_PCT_BW,
  GRAIN_MCAL_PER_LB,
  HAY_MCAL_PER_LB,
  WORKLOADS,
} from "~/data/sample";
import type { DemoSiteData } from "~/data/demoSites";

interface Result {
  bwKg: number;
  deMcal: number;
  forageLb: number;
  forageMcal: number;
  gapMcal: number;
  grainLb: number;
}

function compute(weightLb: number, coefficient: number): Result {
  const bwKg = weightLb * 0.4536;
  const deMcal = coefficient * bwKg;
  const forageLb = weightLb * FORAGE_PCT_BW; // base forage at ~1.8% BW
  const forageMcal = forageLb * HAY_MCAL_PER_LB;
  const gapMcal = Math.max(0, deMcal - forageMcal);
  const grainLb = gapMcal / GRAIN_MCAL_PER_LB;
  return { bwKg, deMcal, forageLb, forageMcal, gapMcal, grainLb };
}

export function HorseEnergyModule({ data }: { data: DemoSiteData }) {
  const [weight, setWeight] = useState<number>(1100);
  const [workload, setWorkload] = useState<string>("moderate");
  const wl = WORKLOADS.find((w) => w.key === workload)!;
  const r = compute(weight, wl.coefficient);

  const useSample = (name: string) => {
    const h = data.sampleHorses.find((s) => s.name === name)!;
    setWeight(h.weightLb);
    setWorkload(h.workload);
  };

  return (
    <div className="space-y-5">
      <Card className="border-amber-300 bg-gradient-to-br from-amber-50 to-white">
        <CardTitle
          title="🐴 Horse Energy & Calorie Estimator"
          sub="Estimate daily digestible energy (calories) from body weight + workload, then match forage & feed."
          right={<Badge tone="amber">Key feature</Badge>}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          {/* inputs */}
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Body weight: <span className="font-bold">{weight.toLocaleString()} lb</span> ({Math.round(r.bwKg)} kg)
            </label>
            <input
              type="range"
              min={600}
              max={2200}
              step={10}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-full accent-amber-600"
            />
            <div className="mb-4 flex justify-between text-xs text-stone-400">
              <span>600 lb (foal/pony)</span>
              <span>2200 lb (draft)</span>
            </div>

            <label className="mb-1 block text-sm font-medium text-stone-700">Workload / activity level</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {WORKLOADS.map((w) => (
                <button
                  key={w.key}
                  onClick={() => setWorkload(w.key)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    w.key === workload
                      ? "border-amber-500 bg-amber-100"
                      : "border-stone-200 bg-white hover:border-amber-300"
                  }`}
                >
                  <span className="block font-semibold text-stone-800">{w.label}</span>
                  <span className="text-xs text-stone-500">{w.description}</span>
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs text-stone-400">Quick-fill from a sample horse:</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {data.sampleHorses.map((h) => (
                <button
                  key={h.name}
                  onClick={() => useSample(h.name)}
                  className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:border-amber-500"
                >
                  {h.name} · {h.weightLb.toLocaleString()} lb
                </button>
              ))}
            </div>
          </div>

          {/* results */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Estimated daily energy needs</p>
            <p className="mt-1 text-4xl font-bold text-amber-800">{r.deMcal.toFixed(1)} <span className="text-lg font-medium text-stone-500">Mcal/day</span></p>
            <p className="mt-1 text-sm text-stone-500">
              for a {weight.toLocaleString()} lb horse at <b>{wl.label}</b>
            </p>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3">
                <span className="text-sm text-stone-700">Base forage (hay) intake</span>
                <span className="text-sm font-bold">{r.forageLb.toFixed(0)} lb</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3">
                <span className="text-sm text-stone-700">Forage supplies (~{HAY_MCAL_PER_LB} Mcal/lb)</span>
                <span className="text-sm font-bold">{r.forageMcal.toFixed(0)} Mcal</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
                <span className="text-sm text-stone-700">Gap → concentrated feed top-up</span>
                <span className="text-sm font-bold text-amber-800">{r.gapMcal.toFixed(0)} Mcal</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                <span className="text-sm font-medium text-green-900">Grain / concentrate to add</span>
                <span className="text-lg font-bold text-green-800">{r.grainLb.toFixed(1)} lb/day</span>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-stone-100 p-3 text-xs leading-relaxed text-stone-600">
              {r.grainLb <= 0 ? (
                <>This workload can be met on quality forage alone — no concentrated grain needed.</>
              ) : (
                <>
                  Rough feeding plan: feed ~{r.forageLb.toFixed(0)} lb of good grass hay and add ~{r.grainLb.toFixed(1)} lb of grain/concentrate, split into 2–3 meals. Adjust for pasture intake and body condition. Values are estimates — always weigh feed and consult a nutritionist.
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.sampleHorses.map((h) => {
          const w = WORKLOADS.find((x) => x.key === h.workload)!;
          const res = compute(h.weightLb, w.coefficient);
          return (
            <Card key={h.name}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{h.name}</h3>
                <Badge tone="blue">{w.label}</Badge>
              </div>
              <p className="text-xs text-stone-500">{h.breed}</p>
              <p className="mt-3 text-2xl font-bold text-stone-900">{res.deMcal.toFixed(1)} <span className="text-sm font-medium text-stone-500">Mcal/day</span></p>
              <p className="text-sm text-stone-500">{h.weightLb.toLocaleString()} lb · {res.grainLb > 0 ? `+${res.grainLb.toFixed(1)} lb grain` : "forage-only"}</p>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-stone-400">
        Uses published equine energy-requirement approximations (NRC-style DE coefficients). Estimates only, not veterinary advice.
      </p>
    </div>
  );
}
