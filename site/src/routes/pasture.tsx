import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { getPastureData } from "~/server/pasture";
import type { Pasture, Species } from "~/types/pasture";

export const Route = createFileRoute("/pasture")({
  loader: () => getPastureData(),
  component: PasturePage,
});

const statusTone: Record<string, "green" | "amber" | "stone" | "blue"> = {
  grazing: "green",
  resting: "amber",
  idle: "stone",
  maintenance: "blue",
};

const obsTone: Record<string, "green" | "amber" | "red" | "blue" | "stone"> = {
  forage: "green",
  water: "blue",
  fence: "stone",
  soil: "amber",
  pest: "red",
  other: "stone",
};

const speciesEmoji: Record<Species, string> = { cattle: "🐄", horse: "🐎", goat: "🐐", sheep: "🐑" };

// ---------------------------------------------------------------------------
// Regional forage & grazing intelligence (the differentiator) — static content
// ---------------------------------------------------------------------------

type Region = {
  id: string;
  label: string;
  climate: string;
  summary: string;
  grasses: { name: string; note: string }[];
  water: string[];
  fertility: string[];
  management: string[];
};

const REGIONS: Region[] = [
  {
    id: "southern-plains",
    label: "Southern Plains · shortgrass & mixed prairie",
    climate: "Hot, semi-arid summers · erratic rainfall · cold dry winters · frequent drought",
    summary:
      "Shortgrass/mixed-grass prairie country. Graze conservatively on native range, grow warm-season pasture where irrigated or in the wetter east. Match stocking to rainfall, not to the calendar.",
    grasses: [
      { name: "Bermudagrass (coastal / Tifton 85)", note: "Excellent warm-season hay & pasture; needs nitrogen and heat; top choice for cattle and horses on cultivated ground." },
      { name: "Old World bluestems (WW-B.Dahl)", note: "Drought-hardy warm-season; great for cattle & sheep, moderate for horses." },
      { name: "Native shortgrass (buffalograss, blue grama)", note: "Very drought-tolerant, lower carrying capacity; best left for winter-stockpiled native range." },
      { name: "Winter wheat / triticale (small-grain)", note: "Cool-season option for fall/spring grazing and a spring grain crop." },
      { name: "Tall fescue (endophyte-free or novel)", note: "Grows in cooler pockets; avoid toxic endophyte fescue for pregnant mares." },
    ],
    water: [
      "Plan 1–2 gallons per 100 lb body weight per day in summer; cattle drinking up to 20+ gal/day in 100°F heat.",
      "Locate tanks within 600 ft of every corner of a paddock — animals walk far less, forage stays uniform.",
      "In drought, expect 30–60% of normal forage growth; keep a hay reserve and be ready to destock early.",
      "Test well water annually for dissolved solids (TDS); high salts depress intake and gains.",
    ],
    fertility: [
      "Soil-test every 2–3 years; bermudagrass hay typically needs 100–200 lb N/acre/year split across the season.",
      "Apply nitrogen after first green-up and again mid-summer; avoid one big early shot that leaches or burns.",
      "Lime to pH 6.0–6.5 for clovers; pastures running cattle on native range often need little beyond phosphorus.",
      "In drought years, drop nitrogen rates — cheap growth you can't keep is wasted or an invitation to overgraze.",
    ],
    management: [
      "Rotate out of a paddock at 3–4 in residual height (bermudagrass) / 4 in (native range) to build recovery.",
      "Stockpile native range in late summer for winter grazing — it answers 40–60 days of hay.",
      "Hydrate bare-ground sacrifice areas near water; they'll erode and stay unproductive without rotation.",
      "Watch grazing near cedar/brush: goats and sheep will follow it, cattle won't — match the animal to the job.",
    ],
  },
  {
    id: "southeast-humid",
    label: "Southeast · humid warm-season (bermudagrass belt)",
    climate: "Hot, humid summers · high rainfall & humidity · mild winters · lush but short-lived cool-season windows",
    summary:
      "High growth rates in summer and heavy hay potential, but high humidity drives parasite pressure and forage quality drops fast as it matures. Tight rotations keep it leafy.",
    grasses: [
      { name: "Coastal / Tifton 85 bermudagrass", note: "The backbone — heavy yields, great for cattle & horses; cut hay at 3–4 weeks for quality." },
      { name: "Bahia grass (Pensacola, Tifton 9)", note: "Lower input, more forgiving on poor soil; good for cattle & sheep, moderate for horses." },
      { name: "Annual / hybrid ryegrass + clover (winter)", note: "Overseed onto bermudagrass for winter grazing; top for lambs and weaning calves." },
      { name: "Pearl millet / sorghum-sudan (summer annual)", note: "Fast, high-summer hay/grazing for cattle; watch prussic acid after frost/first cutting." },
    ],
    water: [
      "Plenty of rainfall, but water STILL rides on placement — a tank in the shade can double summer intake.",
      "Watch overloaded creeks and pond margins: ruts and foul water breed foot problems and lower intake.",
      "In dry spells 4–6 weeks long, growth stops even on bermudagrass — budget a hay reserve.",
      "High humidity + heat raises the risk of waterborne algae; keep troughs scrubbed when water is warm.",
    ],
    fertility: [
      "Bermudagrass responds hard to nitrogen — 150–250 lb N/acre/year split 3–4 ways for hay; less for grazing.",
      "Soil pH 6.0–6.5; lime most eastern Coastal soils. Annual clover seeding needs P and K, not just N.",
      "Don't topdress all nitrogen in spring — it feeds a flush you can't stock, then runs out in August.",
      "Sulfur and potassium matter on sandy Coastal soils; follow the soil test, not a generic routine.",
    ],
    management: [
      "Bermudagrass is 50% quality lost by 6 weeks of growth — rotate every 2–3 weeks to keep it leafy.",
      "Graze to 3–4 in and let it recover 7–10+ days in fast growth, much longer in summer slumps.",
      "Overseed cool-season ryegrass/clover to stretch the grazing year and cut hay use 60–90 days.",
      "Parasite load is high with warm-season humidity — frequent rotation and rest are your first dewormer.",
    ],
  },
  {
    id: "midwest-cool",
    label: "Midwest · cool-season (fescue, orchard, timothy, clover)",
    climate: "Four distinct seasons · cold winters · reliable rainfall · strong spring & fall growth peaks",
    summary:
      "Cool-season grasses drive growth in spring and fall with a summer slump. Management is about cushioning the summer and stretching fall growth for winter stockpile.",
    grasses: [
      { name: "Tall fescue (novel endophyte best)", note: "Dependable year-round; use endophyte-free/novel for mares and lactating cows." },
      { name: "Orchardgrass", note: "Palatable, well-timed growth; great with cattle, horses, goats & sheep; heads out fast." },
      { name: "Smooth bromegrass", note: "Cold-hardy, excellent for hay and late-fall stockpiling." },
      { name: "Timothy", note: "The classic horse hay — fine-stemmed, palatable, low sugar; lower yield." },
      { name: "White & red clover / alfalfa mix", note: "Fix nitrogen and lift protein; watch bloat risk on lush legume-dominant pasture for cattle." },
    ],
    water: [
      "Spring water is rarely the issue — summer is. Provide clean shade water that stays cool when rain shuts off.",
      "On heavy clays, fence fragile low areas and use a lane to a central hardened water source.",
      "Fall stockpile grazing can carry a herd 30–60 days with no water travel penalty if tanks are placed right.",
      "Test water in winter too — ice-capped troughs quietly cut intake by a third.",
    ],
    fertility: [
      "Lime cool-season swards to pH 6.3–6.8 for legumes; most Midwest pasture needs P and K before N.",
      "Nitrogen pays on grazing but split it: early spring (green-up) and late-summer (fall stockpile push).",
      "Legume-based stands may need little fertilizer N — let the clover/alfalfa do it and keep P/K up.",
      "Clip or graze seedheads before they scorch regrowth; fertility buys nothing if it all heads out at once.",
    ],
    management: [
      "Rotate hard in spring (7–14-day moves), then back off in the summer slump so recovery isn't grazed off.",
      "Stockpile 4–6 weeks of fall growth (Aug–Sep) and graze it into winter — the cheapest winter feed you'll ever grow.",
      "Grazed fescue is quality feed; it turns stemmy fast, so keep the rotation tight through the flush.",
      "Avoid continuous spring grazing — it scalps the stand and lets weeds (thistles, fescue toxic endophyte) take over.",
    ],
  },
  {
    id: "intermountain-west",
    label: "Intermountain West · irrigated & sagebrush steppe",
    climate: "High, dry, sun-drenched · cold winters · summer irrigation is the difference between pasture and desert",
    summary:
      "Forage only grows where water does. Irrigated alfalfa/timothy bottoms carry the ranch; native sagebrush steppe is low-yield winter range. Water rights and irrigation timing run the operation.",
    grasses: [
      { name: "Irrigated alfalfa / grass mix", note: "The powerhouse — multiple cuttings, tops the ration for cattle & horses; start with a soil test + water check." },
      { name: "Timothy / orchardgrass (irrigated)", note: "High-quality horse hay; orchard heads out fast, timothy is gold for the barn." },
      { name: "Crested wheatgrass (native range improvement)", note: "Early-spring and fall grazing on dryland, tough and dependable." },
      { name: "Russian wildrye", note: "Excellent fall/winter pasture on dryland, stays green and palatable into cold." },
    ],
    water: [
      "Irrigation timing IS the forage plan — first watering drives the first cutting, late water drives regrowth.",
      "Apply the right depth per pass and rotate water efficiently; every pasture has a critical watering window.",
      "Keep native range for winter and drought; don't let it be grazed in the soggy spring growth window.",
      "Plan for snowmelt and rights sharing — budget pasture growth against what you can actually irrigate.",
    ],
    fertility: [
      "Soil-test irrigated bottoms; alfalfa needs pH 6.5–7.0 and often no nitrogen once fixed — watch P, K, sulfur, boron.",
      "Cool-season grass stands respond to split nitrogen around irrigation events, not one early dump.",
      "Native dryland range rarely pays for fertilizer — leave it and manage stocking instead.",
      "On high-salt western soils, test for salinity before amending; fighting salt wastes money and water.",
    ],
    management: [
      "Match grazing to water turns: graze after you irrigate, then rest while the next turn fills.",
      "Protect spring growth on both irrigated and native ground — early overgrazing costs all summer.",
      "Stockpile flood or wheel-line bottoms for winter; irrigated fall growth carries the most cow-days per acre.",
      "Rotate animals off wet, freshly-irrigated soil to avoid trampling and compromising the stand.",
    ],
  },
  {
    id: "northeast-humid",
    label: "Northeast · humid cool-season & dairy country",
    climate: "Cool-moist springs, mild summers, long winters · reliable rain · perennial-based hay & grazing systems",
    summary:
      "Green almost year-round on perennial stands, but soft ground, long winters, and short grazing windows reward intense rotational systems and a big stored-feed reserve.",
    grasses: [
      { name: "Orchardgrass + clover", note: "Strong, palatable, and keeps quality under the fast northeast growth window." },
      { name: "Kentucky bluegrass", note: "Softer, horse-friendly, recovers well from close grazing." },
      { name: "Timothy", note: "Classic dairy/horse hay; palatable, easy to cure if the weather cooperates." },
      { name: "Ryegrass (annual/perennial)", note: "Fast regrowth, great in a rotation; wet springs need careful traffic management." },
    ],
    water: [
      "Water is rarely limiting—soft ground and mud are. Use hardened, fenced in-lane water so animals don't loaf in wet spots.",
      "Long winters mean heated or frequently-checked troughs; ice cuts winter intake and milk/weight gain.",
      "Direct runoff away from lanes and feeding pads to keep the stand and ground firm.",
      "Clean and check troughs in late spring — warm slits build algae and slime fast in humid weather.",
    ],
    fertility: [
      "Most northeast pasture runs pH 5.5–6.0 — lime is the first and cheapest fertility fix.",
      "Clover/grass stands need phosphorus and potassium; keep N light where legumes do the work.",
      "Split nitrogen for the spring flush and the fall stockpile; watch grass tetany risk on lush spring growth for lactating cows.",
      "Manure from the dairy/pig yard is a fertility asset — time applications to growing stands, not frozen ground.",
    ],
    management: [
      "Rotational grazing shines here: tight moves in the damp spring, then rest to let stands dry and regrow.",
      "Plan winter feed around a big stored reserve — long mud seasons burn more hay than the coldest days suggest.",
      "Keep lush spring pasture off bloat-prone cattle by feeding a bit of dry forage before turnout.",
      "Clip pastures after a rotation to keep weeds and seedheads down and the sward leafy for the next pass.",
    ],
  },
];

const FORAGE_MATCH: { animal: Species; emoji: string; good: string; cautions: string }[] = [
  {
    animal: "cattle",
    emoji: "🐄",
    good: "Bermudagrass, bahia, tall fescue (novel), orchardgrass, smooth brome, sorghum-sudan, small grains, native range; alfalfa/clover mixes for protein.",
    cautions: "Watch bloat on lush legume-dominant pasture; prussic acid in sorghum/sudan after frost or stress; fescue foot & summer slump on toxic endophyte.",
  },
  {
    animal: "horse",
    emoji: "🐎",
    good: "Timothy, Kentucky bluegrass, orchardgrass, bermudagrass, teff; smooth, fine-stemmed, lower-sugar grasses are safest.",
    cautions: "Avoid toxic endophyte tall fescue (pregnant mares especially); limit lush high-fructan grass for laminitis/EMS-prone horses; no sorghum-sudan.",
  },
  {
    animal: "goat",
    emoji: "🐐",
    good: "Brush, browse, and broadleaf plus mixed pasture; orchardgrass, fescue, and weedy/scrub ground — goats eat what cattle ignore.",
    cautions: "Watch copper/toxicity from brassicas and some plants; fence tightly — goats escape under and through; guard against worm burden with rotation.",
  },
  {
    animal: "sheep",
    emoji: "🐑",
    good: "Orchardgrass, fescue, ryegrass, bermudagrass, clover mixes; close-grazing animals that do well on mixed sward.",
    cautions: "Bloat on lush clover/alfalfa; parasitism on warm humid pasture — rotate to rest eggs; avoid forage with heavy seedheads (wool contamination).",
  },
];

const GRAZING_SYSTEMS = [
  {
    name: "Rotational grazing",
    emoji: "🔄",
    tagline: "Several paddocks, moved on a schedule.",
    body: "Split pasture into paddocks and move livestock every few days to weeks so each one is grazed hard then rested long enough to regrow.",
    pros: ["Best regrowth & carrying capacity per acre", "Even manure distribution, cleaner sward", "Can stockpile and extend the grazing season", "Grazing/rest data makes moves measurable (like this module!)"],
    cons: ["More fencing, water lines, and daily management", "Up-front setup cost in gates and lanes", "Needs enough paddocks for the herd to rest properly"],
    fits: "Best for most operations — ranches of any size, horses, goats, sheep, and warm-season cattle when you want more from less land.",
  },
  {
    name: "Continuous / single-pasture",
    emoji: "➡️",
    tagline: "One pasture, livestock roam freely all season.",
    body: "Animals stay in one large pasture all year (or all season). Simplest to run; the trade-off is that preferred plants get grazed hard while others go to seed.",
    pros: ["Least fence, water, and labor", "Cheapest to set up, low day-to-day decisions", "Let animals pick their own diet (some do well on native range)"],
    cons: ["Uneven use — overgrazed spots, undergrazed spots", "Poorer regrowth, more weeds and bare soil", "Parasite/worm build-up with no resting paddocks", "Lower carrying capacity over time"],
    fits: "Best for very extensive native range (low stocking), hobby setups, or the first season before you build infrastructure.",
  },
  {
    name: "Feedlot / drylot (grain finishing)",
    emoji: "🏭",
    tagline: "Confined lots, ration-fed, no grazing.",
    body: "Animals are kept in pens and fed a controlled ration — for-age and/or grain — rather than grazing. Used for backgrounding and finishing cattle.",
    pros: ["Maximum gain per head & predictable finish", "No fencing/water on open range; feeds measured precisely", "Frees pasture for other classes of stock or hay"],
    cons: ["Manure handling, hard surface, and clean-water needs", "Feed cost is high; lot mud/fly/pressure problems", "Rations must be balanced on forage-to-concentrate ratio"],
    fits: "Best for backgrounding/grain-finishing programs and operations that want to separate the grazing herd from a finishing group (see grass-to-grain rations below).",
  },
];

function EnvironmentIntelligence() {
  const [regionId, setRegionId] = useState(REGIONS[0].id);
  const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0];

  return (
    <>
      {/* Region selector */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-green-200 bg-green-50/50 p-4">
        <div>
          <p className="text-sm font-semibold text-green-900">Pick your climate &amp; region</p>
          <p className="text-xs text-green-800/70">Recommendations re-target for water, soil, and the grasses that fit your ground.</p>
        </div>
        <select
          className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-green-700"
          value={regionId}
          onChange={(e) => setRegionId(e.target.value)}
        >
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardTitle title={`${region.label.split("·")[0].trim()} plan`} sub={region.climate} />
        <p className="mb-4 text-sm text-stone-600">{region.summary}</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-stone-800">🌱 Best grass &amp; forage species here</h4>
            <ul className="space-y-1.5">
              {region.grasses.map((g) => (
                <li key={g.name} className="rounded-xl border border-stone-100 px-3 py-2 text-sm">
                  <span className="font-semibold text-stone-900">{g.name}</span>
                  <p className="text-stone-600">{g.note}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-5">
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-stone-800">💧 Seasonal water needs</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-stone-600">
                {region.water.map((w) => <li key={w.slice(0, 24)}>{w}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-stone-800">🧪 Fertilization &amp; soil</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-stone-600">
                {region.fertility.map((f) => <li key={f.slice(0, 24)}>{f}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-stone-800">🚜 Management guidance</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-stone-600">
                {region.management.map((m) => <li key={m.slice(0, 24)}>{m}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </Card>

      {/* Forage-to-animal matching */}
      <Card>
        <CardTitle title="Match forage to the animal" sub="Which grasses suit which stock — cattle, horses, goats, sheep" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Animal</th>
                <th className="py-2 pr-3">Good grass &amp; forage</th>
                <th className="py-2 pr-3">Cautions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {FORAGE_MATCH.map((m) => (
                <tr key={m.animal} className="align-top transition hover:bg-green-50/50">
                  <td className="whitespace-nowrap py-2.5 pr-3 font-semibold text-stone-900">
                    {m.emoji} {m.animal}
                  </td>
                  <td className="py-2.5 pr-3 text-stone-700">{m.good}</td>
                  <td className="py-2.5 text-stone-600">{m.cautions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Grazing system comparison */}
      <Card>
        <CardTitle title="Rotational vs. continuous vs. feedlot" sub="Which grazing system fits your setup" />
        <div className="grid gap-4 md:grid-cols-3">
          {GRAZING_SYSTEMS.map((s) => (
            <div key={s.name} className="flex flex-col rounded-2xl border border-stone-200 p-4">
              <div className="mb-1 text-2xl">{s.emoji}</div>
              <h4 className="text-sm font-bold text-stone-900">{s.name}</h4>
              <p className="text-xs italic text-stone-500">{s.tagline}</p>
              <p className="mt-2 text-sm text-stone-600">{s.body}</p>
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-green-800">Strengths</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-stone-600">
                  {s.pros.map((p) => <li key={p.slice(0, 24)}>{p}</li>)}
                </ul>
              </div>
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">Trade-offs</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-stone-600">
                  {s.cons.map((c) => <li key={c.slice(0, 24)}>{c}</li>)}
                </ul>
              </div>
              <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">{s.fits}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl border border-green-200 bg-green-50/50 px-3 py-2 text-xs text-green-900">
          🥩 For feedlot / grain-finishing setups: balance the ration on forage-to-concentrate ratio — start finishing cattle on
          mostly forage and step grain up gradually to keep the rumen healthy; a high-concentrate finish ration is typically
          70–90% grain, introduced over 2–3 weeks. This is the grass-to-grain guidance behind the plan&apos;s feedlot support.
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type PastureRow = {
  pasture: Pasture;
  assignment: { name: string | null; species: Species | null } | null;
  currentStatus: "grazing" | "rest" | "idle";
  runDays: number;
  grazed21: number;
  rested21: number;
};

function PasturePage() {
  const data = Route.useLoaderData();

  const meta = useMemo(() => {
    const windowStart = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    const map = new Map<number, { currentStatus: "grazing" | "rest"; runDays: number; grazed21: number; rested21: number }>();
    for (const p of data.pastures) {
      const days = data.grazing
        .filter((g) => g.pasture_id === p.id)
        .sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
      const recent = days[days.length - 1];
      const currentStatus: "grazing" | "rest" = recent?.status ?? "rest";
      let runDays = 0;
      for (let i = days.length - 1; i >= 0; i--) {
        if (days[i].status === currentStatus) runDays += 1;
        else break;
      }
      const inWindow = days.filter((g) => g.log_date >= windowStart);
      map.set(p.id, {
        currentStatus,
        runDays,
        grazed21: inWindow.filter((g) => g.status === "grazing").length,
        rested21: inWindow.filter((g) => g.status === "rest").length,
      });
    }
    return map;
  }, [data.pastures, data.grazing]);

  const rows = useMemo<PastureRow[]>(() => {
    const activeByPasture = new Map<number, PastureRow["assignment"]>();
    for (const a of data.assignments) {
      if (a.ended_at) continue;
      activeByPasture.set(a.pasture_id, { name: a.herd_group_name, species: a.species });
    }
    return data.pastures.map((p) => {
      const m = meta.get(p.id);
      const currentStatus = m?.currentStatus === "grazing" ? "grazing" : m?.currentStatus === "rest" ? "rest" : p.status === "grazing" ? "grazing" : "idle";
      return {
        pasture: p,
        assignment: activeByPasture.get(p.id) ?? null,
        currentStatus,
        runDays: m?.runDays ?? 0,
        grazed21: m?.grazed21 ?? 0,
        rested21: m?.rested21 ?? 0,
      };
    });
  }, [data.pastures, data.assignments, meta]);

  const totals = useMemo(() => {
    const acres = data.pastures.reduce((s, p) => s + Number(p.size_acres), 0);
    const grazing = rows.filter((r) => r.currentStatus === "grazing");
    const grazingAcres = grazing.reduce((s, r) => s + Number(r.pasture.size_acres), 0);
    return {
      acres,
      paddocks: data.pastures.length,
      activeAssignments: data.assignments.filter((a) => !a.ended_at).length,
      grazingAcres,
      openActions: data.observations.filter((o) => o.action_due).length,
    };
  }, [data.pastures, data.assignments, data.observations, rows]);

  // Sorted observations with any action due, soonest first.
  const actions = useMemo(
    () =>
      data.observations
        .filter((o) => o.action_due)
        .sort((a, b) => (a.action_due! < b.action_due! ? -1 : 1))
        .map((o) => {
          const p = data.pastures.find((x) => x.id === o.pasture_id);
          return { ...o, pastureName: p?.name ?? "—" };
        }),
    [data.observations, data.pastures]
  );

  // Same loading/error/no-DB guards as livestock / feed.
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🚜 Database not configured"
            sub="Pasture records persist to Postgres — no connection string is set in this environment."
          />
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-stone-700">
            <li>
              Set <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to a Postgres
              connection string.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:migrate</code> to create the
              pasture &amp; grazing tables.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> to load the demo
              paddocks, assignments, and grazing history.
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-500">
            Meanwhile, the <Link to="/demo" className="font-semibold text-green-700 hover:text-green-900">interactive demo</Link>{" "}
            shows the same workflows with sample data.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
            <Link to="/livestock" className="btn-outline !px-4 !py-2 text-sm">Livestock module</Link>
            <Link to="/feed" className="btn-outline !px-4 !py-2 text-sm">Feed &amp; Hay</Link>
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
          <CardTitle title="Database error" sub="The database is configured but the pasture records could not be read." />
          <pre className="overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-red-800">{data.error}</pre>
          <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Pasture acres" value={totals.acres.toLocaleString()} sub="across the whole operation" accent />
        <Stat label="Paddocks" value={String(totals.paddocks)} sub="fields & paddocks managed" />
        <Stat label="Acres in rotation" value={totals.grazingAcres.toLocaleString()} sub="under active grazing now" />
        <Stat label="Active assignments" value={String(totals.activeAssignments)} sub="herds on pasture today" />
        <Stat label="Actions due" value={String(totals.openActions)} sub="observations needing follow-up" accent={totals.openActions > 0} />
      </div>

      {/* Actions due — the "today" hook */}
      <Card className={actions.length ? "border-amber-200 bg-amber-50/40" : ""}>
        <CardTitle
          title="Pasture actions due"
          sub={actions.length ? "From observations with a follow-up date — soonest first" : "No follow-ups scheduled on any paddock"}
          right={actions.length ? <Badge tone="amber">{actions.length} due</Badge> : <Badge tone="green">All caught up</Badge>}
        />
        {actions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing due right now. 🎉 Record an observation to set a follow-up.
          </p>
        ) : (
          <div className="space-y-2">
            {actions.slice(0, 8).map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 bg-white px-3 py-2.5">
                <span className="w-20 shrink-0 text-xs font-semibold text-amber-700">{o.action_due}</span>
                <Badge tone={obsTone[o.category] ?? "stone"}>{o.category}</Badge>
                <span className="w-44 shrink-0 truncate text-sm font-semibold text-stone-800">{o.pastureName}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-600">{o.note}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pasture / grazing board */}
      <Card>
        <CardTitle
          title="Pasture &amp; grazing board"
          sub="Each paddock's size, current herd, and grazing/rest state (last 21 days)"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-4xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Paddock</th>
                <th className="py-2 pr-3">Acres</th>
                <th className="py-2 pr-3">Location</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Assigned herd</th>
                <th className="py-2 pr-3">Grazing</th>
                <th className="py-2 pr-3">Rest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const grazing = r.currentStatus === "grazing";
                return (
                  <tr key={r.pasture.id} className="align-top transition hover:bg-green-50/50">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-stone-900">🌾 {r.pasture.name}</span>
                      {r.pasture.notes && <span className="block max-w-xs text-xs text-stone-400">{r.pasture.notes}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 font-medium text-stone-700">
                      {Number(r.pasture.size_acres).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600">{r.pasture.location ?? "—"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <Badge tone={statusTone[r.pasture.status] ?? "stone"}>{r.pasture.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-stone-700">
                      {r.assignment?.name ? (
                        <>
                          {r.assignment.species ? `${speciesEmoji[r.assignment.species]} ` : ""}
                          {r.assignment.name}
                        </>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <Badge tone={grazing ? "green" : "stone"}>
                        {grazing ? `Grazing · ${r.runDays}d` : `Rest · ${r.runDays}d`}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-stone-600">
                      <span className="text-stone-900">{r.grazed21}d</span> grazed · <span className="text-stone-900">{r.rested21}d</span> rest
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-stone-500">
                    No paddocks on record yet — run{" "}
                    <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> for the demo
                    rotation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-stone-400">
          {rows.length} paddocks · grazing/rest tallied over the last 21 days · live Postgres records
        </p>
      </Card>

      {/* Regional forage & grazing intelligence */}
      <div>
        <h2 className="mb-1 text-xl font-bold text-stone-900 sm:text-2xl">Regional forage &amp; grazing intelligence</h2>
        <p className="mb-4 max-w-2xl text-sm text-stone-600">
          Region-aware grass selection, seasonal water &amp; fertilizer guidance, animal-to-forage matching, and the trade-offs
          between grazing systems — the layer that turns a pasture list into a grazing plan.
        </p>
        <EnvironmentIntelligence />
      </div>
    </Shell>
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
            Pasture &amp; Grazing
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/livestock" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Livestock
          </Link>
          <Link to="/feed" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Feed &amp; Hay
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
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">Third real module · live database</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">Pasture &amp; Grazing</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Paddocks, grazing/rest rotations, and region-aware forage guidance — so the right herd grazes the right ground at
            the right time.
          </p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Pasture &amp; Grazing module (MVP)</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
