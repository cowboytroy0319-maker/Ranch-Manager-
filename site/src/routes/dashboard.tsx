import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AppShell } from "~/components/AppShell";
import { Badge } from "~/components/ui";
import { MorningBriefing } from "~/components/dashboard/MorningBriefing";
import { LivestockSnapshot } from "~/components/dashboard/LivestockSnapshot";
import { FeedSnapshot } from "~/components/dashboard/FeedSnapshot";
import { PastureSnapshot } from "~/components/dashboard/PastureSnapshot";
import { EquipmentSnapshot } from "~/components/dashboard/EquipmentSnapshot";
import { CostsSnapshot } from "~/components/dashboard/CostsSnapshot";
import { CalendarSnapshot } from "~/components/dashboard/CalendarSnapshot";
import { TaxSnapshot } from "~/components/dashboard/TaxSnapshot";
import { TasksSnapshot } from "~/components/dashboard/TasksSnapshot";
import { getLivestockData } from "~/server/livestock";
import { getTaxExemptionsData } from "~/server/taxExemptions";
import { getFeedData } from "~/server/feed";
import { getPastureData } from "~/server/pasture";
import { getEquipmentData } from "~/server/equipment";
import { getCostData } from "~/server/costs";
import { getExpensesData } from "~/server/expenses";
import { getDashboardTasks } from "~/server/tasks";
import { getOnboarding } from "~/server/onboarding";
import { SetupProgressCard } from "~/components/dashboard/SetupProgressCard";
import { getSession } from "~/server/auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  // Load every real dataset behind the Daily Operations board in one round trip.
  loader: async () => {
    const [livestock, feed, pasture, equipment, costs, expenses, tax, tasks, onboarding] = await Promise.all([
      getLivestockData(),
      getFeedData(),
      getPastureData(),
      getEquipmentData(),
      getCostData(),
      getExpensesData(),
      getTaxExemptionsData(),
      getDashboardTasks(),
      getOnboarding(),
    ]);
    return { livestock, feed, pasture, equipment, costs, expenses, tax, tasks, onboarding };
  },
  component: Dashboard,
});

function Dashboard() {
  const { livestock, feed, pasture, equipment, costs, expenses, tax, tasks, onboarding } = Route.useLoaderData();
  const router = useRouter();
  const retryTasks = () => void router.invalidate();

  // Live headline numbers: active head from livestock, fuel spend this month.
  const activeHead = livestock.animals.filter((a) => a.status === "active").length;
  const fuelCents = costs.fuel?.totalCents ?? 0;

  return (
    <AppShell
      badge="Daily Operations · Live data"
      eyebrow="The morning briefing"
      title="What do I need to do today?"
      subtitle="Livestock health needs, pasture moves, hay and feed, fuel and equipment use, maintenance due, and upcoming renewals — live from your operation."
    >
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
        {/* 0. Setup progress (hidden when done) — never traps the user */}
        <SetupProgressCard data={onboarding} />
        {/* 1. Today's priorities */}
        <MorningBriefing data={{ livestock, feed, pasture, equipment }} />
        {/* 1b. Today's tasks — overdue/due-today/high-priority open work */}
        <TasksSnapshot tasks={tasks.tasks} error={tasks.error} onRetry={retryTasks} />
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
        <div className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>Daily Operations (live data)</span>
          <Link to="/demo" className="font-medium text-green-700 hover:text-green-900">
            Explore the full demo modules →
          </Link>
        </div>
    </AppShell>
  );
}
