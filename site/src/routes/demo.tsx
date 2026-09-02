import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SITES } from "~/data/sample";
import { getDemoData } from "~/data/demoSites";
import type { DemoSiteData } from "~/data/demoSites";

// Module views
import { OverviewModule } from "~/components/demo/OverviewModule";
import { LivestockModule } from "~/components/demo/LivestockModule";
import { HorseEnergyModule } from "~/components/demo/HorseEnergyModule";
import { FeedModule } from "~/components/demo/FeedModule";
import { PastureModule } from "~/components/demo/PastureModule";
import { EquipmentModule } from "~/components/demo/EquipmentModule";
import { ComplianceModule } from "~/components/demo/ComplianceModule";
import { FuelModule } from "~/components/demo/FuelModule";
import { CostsModule } from "~/components/demo/CostsModule";

export const Route = createFileRoute("/demo")({
  component: Demo,
});

type TabKey =
  | "Overview"
  | "Livestock"
  | "Horse Energy"
  | "Hay & Feed"
  | "Pasture & Forage"
  | "Equipment"
  | "Registrations"
  | "Fuel"
  | "Costs";

const TABS: { key: TabKey; icon: string }[] = [
  { key: "Overview", icon: "📊" },
  { key: "Livestock", icon: "🐄" },
  { key: "Horse Energy", icon: "🐴" },
  { key: "Hay & Feed", icon: "🌾" },
  { key: "Pasture & Forage", icon: "🌱" },
  { key: "Equipment", icon: "🚜" },
  { key: "Registrations", icon: "📑" },
  { key: "Fuel", icon: "⛽" },
  { key: "Costs", icon: "💰" },
];

function Demo() {
  const [tab, setTab] = useState<TabKey>("Overview");
  const [site, setSite] = useState<string>("all");
  const data: DemoSiteData = getDemoData(site);

  // Reset per-ranch state (reminders, equipment, compliance) whenever the
  // selected ranch changes so each ranch starts from its own dataset.
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => setResetKey((k) => k + 1), [site]);

  return (
    <div className="flex min-h-dvh flex-col bg-stone-100">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            <span className="hidden font-bold text-stone-900 sm:inline">Ranch Manager Pro</span>
          </Link>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            Sample data
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="hidden text-stone-500 sm:inline">Site:</label>
          <select
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700"
          >
            <option value="all">All {SITES.length} sites</option>
            {SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Link to="/dashboard" className="rounded-lg border border-green-700 bg-green-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-900">
            🌅 Daily Ops
          </Link>
          <Link to="/" className="ml-1 hidden text-xs font-medium text-stone-500 hover:text-green-800 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* Sidebar nav */}
        <aside className="w-full shrink-0 border-b border-stone-200 bg-white md:w-56 md:border-b-0 md:border-r">
          <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  tab === t.key
                    ? "bg-green-800 text-white"
                    : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                <span>{t.icon}</span>
                {t.key}
              </button>
            ))}
          </nav>
          <div className="hidden border-t border-stone-100 p-3 text-xs text-stone-500 md:block">
            <p className="font-semibold">Scale you can grow into</p>
            <p className="mt-1">Manage one ranch or oversee a multi-site commercial operation — same view, one login.</p>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-stone-900">{tab}</h1>
              <p className="text-sm text-stone-500">
                Showing {site === "all" ? "all sites combined" : SITES.find((s) => s.id === site)?.name} · {data.totalAu.toLocaleString()} total AU · YTD ${Math.round(data.totalYtd / 1000)}k
              </p>
            </div>
          </div>

          {tab === "Overview" && <OverviewModule key={`overview-${resetKey}`} data={data} />}
          {tab === "Livestock" && <LivestockModule key={`livestock-${resetKey}`} data={data} />}
          {tab === "Horse Energy" && <HorseEnergyModule data={data} />}
          {tab === "Hay & Feed" && <FeedModule data={data} />}
          {tab === "Pasture & Forage" && <PastureModule data={data} />}
          {tab === "Equipment" && <EquipmentModule key={`equip-${resetKey}`} data={data} />}
          {tab === "Registrations" && <ComplianceModule key={`comp-${resetKey}`} data={data} />}
          {tab === "Fuel" && <FuelModule data={data} />}
          {tab === "Costs" && <CostsModule data={data} />}
        </main>
      </div>
    </div>
  );
}
