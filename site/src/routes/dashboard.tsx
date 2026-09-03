import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Badge } from "~/components/ui";
import { MorningBriefing } from "~/components/dashboard/MorningBriefing";
import { LivestockSnapshot } from "~/components/dashboard/LivestockSnapshot";
import { FeedSnapshot } from "~/components/dashboard/FeedSnapshot";
import { PastureSnapshot } from "~/components/dashboard/PastureSnapshot";
import { EquipmentSnapshot } from "~/components/dashboard/EquipmentSnapshot";
import { CostsSnapshot } from "~/components/dashboard/CostsSnapshot";
import { CalendarSnapshot } from "~/components/dashboard/CalendarSnapshot";
import { TaxSnapshot } from "~/components/dashboard/TaxSnapshot";
import { getLivestockData } from "~/server/livestock";
import { getTaxExemptionsData } from "~/server/taxExemptions";
import { getFeedData } from "~/server/feed";
import { getPastureData } from "~/server/pasture";
import { getEquipmentData } from "~/server/equipment";
import { getCostData } from "~/server/costs";
import { getExpensesData } from "~/server/expenses";
import { getSession } from "~/server/auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  // Load every real dataset behind the Daily Operations board in one round trip.
  loader: async () => {
    const [livestock, feed, pasture, equipment, costs, expenses, tax] = await Promise.all([
      getLivestockData(),
      getFeedData(),
      getPastureData(),
      getEquipmentData(),
      getCostData(),
      getExpensesData(),
      getTaxExemptionsData(),
    ]);
    return { livestock, feed, pasture, equipment, costs, expenses, tax };
  },
  component: Dashboard,
});

function Dashboard() {
  const { livestock, feed, pasture, equipment, costs, expenses, tax } = Route.useLoaderData();

  // Live headline numbers: active head from livestock, fuel spend this month.
  const activeHead = livestock.animals.filter((a) => a.status === "active").length;
  const fuelCents = costs.fuel?.totalCents ?? 0;

  return (
    <div className="min-h-dvh bg-stone-100">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            <span className="hidden font-bold text-stone-900 sm:inline">Ranch Manager Pro</span>
          </Link>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            Daily Operations
          </span>
          <span className="hidden rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800 sm:inline">
            Live data
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/livestock" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Livestock
          </Link>
          <Link to="/feed" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Feed &amp; Hay
          </Link>
          <Link to="/pasture" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Pasture
          </Link>
          <Link to="/equipment" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Equipment
          </Link>
          <Link to="/expenses" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Expenses
          </Link>
          <Link to="/employees" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Employees
          </Link>
          <Link to="/tax-exemptions" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Tax &amp; Exemptions
          </Link>
          <Link to="/analytics" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Analytics
          </Link>
          <Link to="/demo" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Demo modules
          </Link>
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Breathing header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">The morning briefing</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">What do I need to do today?</h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              One scannable view of your operation — your day, faster than a notebook at the gate, tank, or shop. Built from your live records.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="green">{activeHead.toLocaleString()} active head</Badge>
            <Badge tone="stone">{costs.fuel ? `$${(fuelCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} fuel this month` : "no fuel logged this month"}</Badge>
          </div>
        </div>
        {/* 1. Today's priorities */}
        <MorningBriefing data={{ livestock, feed, pasture, equipment }} />
        {/* 2-3. Livestock + Feed */}
        <div className="grid gap-6 lg:grid-cols-2">
          <LivestockSnapshot data={livestock} />
          <FeedSnapshot data={feed} />
        </div>
        {/* 4-5. Pasture + Equipment */}
        <div className="grid gap-6 lg:grid-cols-2">
          <PastureSnapshot data={pasture} />
          <EquipmentSnapshot data={equipment} />
        </div>
        {/* 6. Costs (with cost allocation) */}
        <CostsSnapshot data={costs} expenses={expenses} />
        {/* 6b. Tax & exemptions — surface expiring/lapsed */}
        <TaxSnapshot data={tax} />
        {/* 7. Calendar */}
        <CalendarSnapshot data={{ livestock, pasture, equipment }} />
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Daily Operations (live data)</span>
          <Link to="/demo" className="font-medium text-green-700 hover:text-green-900">
            Explore the full demo modules →
          </Link>
        </footer>
      </main>
    </div>
  );
}
