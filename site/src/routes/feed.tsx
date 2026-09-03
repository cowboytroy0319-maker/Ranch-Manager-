import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { getSession } from "~/server/auth";
import { useMemo, useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { FeedFormModal, HayFormModal, LogUsageModal, hayLabel } from "~/components/feed/FeedModals";
import { getFeedData } from "~/server/feed";
import {
  USAGE_RATE_WINDOW_DAYS,
  fmtQty,
  fmtDollars,
  hayDaysLeftForItem,
  hayDaysLeftOverall,
  hayTons,
  lowStockItems,
  type FeedItem,
  type HayItem,
} from "~/types/feed";

export const Route = createFileRoute("/feed")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getFeedData(),
  component: FeedPage,
});

const hayTypeEmoji: Record<string, string> = {
  grass: "🌿",
  alfalfa: "🍀",
  mixed: "🌾",
  other: "📦",
};

function FeedPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  const [editingHay, setEditingHay] = useState<HayItem | null>(null);
  const [addHayOpen, setAddHayOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<FeedItem | null>(null);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageSel, setUsageSel] = useState<{ kind: "hay" | "feed"; id: number } | null>(null);

  const openUsage = (sel: { kind: "hay" | "feed"; id: number } | null) => {
    setUsageSel(sel);
    setUsageOpen(true);
  };

  const pastures = useMemo(
    () =>
      [
        ...new Set(
          [...data.usage.map((u) => u.pasture), ...data.hay.map((h) => h.field_or_source)].filter(
            (p): p is string => Boolean(p)
          )
        ),
      ].sort(),
    [data.hay, data.usage]
  );

  // Overview numbers — the ones an operator actually thinks in.
  const stats = useMemo(() => {
    const totalBales = data.hay.filter((h) => h.unit === "bales").reduce((s, h) => s + h.quantity, 0);
    const totalTons = data.hay.reduce((s, h) => s + hayTons(h), 0);
    const daysLeft = hayDaysLeftOverall(data.hay, data.usage);
    const low = lowStockItems(data.hay, data.feed);
    return { totalBales, totalTons, daysLeft, low };
  }, [data.hay, data.feed, data.usage]);

  const usageItemLabel = (hayItemId: number | null, feedItemId: number | null): string => {
    if (hayItemId != null) {
      const h = data.hay.find((x) => x.id === hayItemId);
      return h ? hayLabel(h) : `hay #${hayItemId}`;
    }
    if (feedItemId != null) {
      const f = data.feed.find((x) => x.id === feedItemId);
      return f ? f.name : `feed #${feedItemId}`;
    }
    return "—";
  };

  // ------------------------------------------------------------------ states
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🚜 Database not configured"
            sub="Hay & feed records persist to Postgres — no connection string is set in this environment."
          />
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-stone-700">
            <li>
              Set <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to a Postgres
              connection string.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:migrate</code> to create the
              hay, feed, and usage-log tables.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> to load the demo
              hay yard (890+ bales plus a tonnage stack), 5 feed items, and 3 weeks of usage history.
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-500">
            Meanwhile, the <Link to="/demo" className="font-semibold text-green-700 hover:text-green-900">interactive demo</Link>{" "}
            shows the same workflows with sample data.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
            <Link to="/livestock" className="btn-outline !px-4 !py-2 text-sm">Livestock module</Link>
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
          <CardTitle title="Database error" sub="The database is configured but the feed records could not be read." />
          <pre className="overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-red-800">{data.error}</pre>
          <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
        </Card>
      </Shell>
    );
  }

  // -------------------------------------------------------------------- page
  const daysLeft = stats.daysLeft;
  return (
    <Shell>
      {/* Overview — hay on hand in the units an operator thinks in */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Hay bales on hand"
          value={Math.round(stats.totalBales).toLocaleString()}
          sub={`${data.hay.filter((h) => h.unit === "bales").length} stacks counted in bales`}
          accent
        />
        <Stat
          label="Estimated tons in the yard"
          value={stats.totalTons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          sub="bales converted by bale weight"
        />
        <Stat
          label="Days of hay left"
          value={daysLeft != null ? `~${daysLeft.toLocaleString()}` : "—"}
          sub={daysLeft != null ? `at the last ${USAGE_RATE_WINDOW_DAYS} days of use` : "log usage to project"}
        />
        <Stat
          label="Low stock"
          value={String(stats.low.length)}
          sub={stats.low.length ? "order today" : "all above thresholds"}
          accent={stats.low.length > 0}
        />
      </div>

      {/* Low stock — the "today" hook */}
      <Card className={stats.low.length ? "border-red-200 bg-red-50/40" : ""}>
        <CardTitle
          title="Low stock"
          sub={stats.low.length ? "At or below the low-stock threshold — reorder or cut back" : "Everything is above its low-stock threshold"}
          right={
            stats.low.length > 0 ? (
              <Badge tone="red">{stats.low.length} to reorder</Badge>
            ) : (
              <Badge tone="green">All stocked</Badge>
            )
          }
        />
        {stats.low.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing below threshold. 🎉
          </p>
        ) : (
          <div className="space-y-2">
            {stats.low.map(({ kind, item }) => (
              <div
                key={`${kind}-${item.id}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 bg-white px-3 py-2.5"
              >
                <Badge tone={kind === "hay" ? "amber" : "blue"}>{kind === "hay" ? "Hay" : "Feed"}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                  {kind === "hay" ? hayLabel(item as HayItem) : (item as FeedItem).name}
                </span>
                <span className="text-sm font-semibold text-red-700">{fmtQty(item.quantity, item.unit)}</span>
                <span className="text-xs text-stone-500">alert at {fmtQty(item.low_stock_threshold, item.unit)}</span>
                <button
                  onClick={() => openUsage({ kind, id: item.id })}
                  className="rounded-lg border border-green-700/40 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 transition hover:bg-green-100"
                >
                  Log use
                </button>
                <button
                  onClick={() => (kind === "hay" ? setEditingHay(item as HayItem) : setEditingFeed(item as FeedItem))}
                  className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                >
                  Restock
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Hay inventory */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle title="Hay yard" sub="Current stacks by cutting and storage" />
          <button onClick={() => setAddHayOpen(true)} className="btn-primary !px-4 !py-2 text-sm">
            + Add hay stack
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Type / cutting</th>
                <th className="py-2 pr-3">Field / source</th>
                <th className="py-2 pr-3">Storage</th>
                <th className="py-2 pr-3">On hand</th>
                <th className="py-2 pr-3">Est. tons</th>
                <th className="py-2 pr-3">Days left</th>
                <th className="py-2 pr-3">Acquired</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.hay.map((h) => {
                const isLow = h.quantity <= h.low_stock_threshold;
                const days = hayDaysLeftForItem(h, data.usage);
                return (
                  <tr key={h.id} className="transition hover:bg-green-50/50">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-stone-900">
                        {hayTypeEmoji[h.feed_type]} {h.feed_type[0].toUpperCase() + h.feed_type.slice(1)}
                      </span>
                      {h.cutting && <span className="block text-xs text-stone-400">{h.cutting} cutting</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-700">{h.field_or_source ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-stone-600">{h.storage_location ?? "—"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <span className={`font-semibold ${isLow ? "text-red-700" : "text-stone-900"}`}>
                        {fmtQty(h.quantity, h.unit)}
                      </span>
                      {h.unit === "bales" && h.bale_weight_lbs && (
                        <span className="block text-xs text-stone-400">~{h.bale_weight_lbs} lb bales</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">
                      {hayTons(h).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">
                      {days != null ? (
                        <span className={days < 30 ? "font-semibold text-amber-700" : ""}>~{days}d</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">{h.date_acquired ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={isLow ? "red" : "green"}>{isLow ? "Low" : "In stock"}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <button
                        onClick={() => openUsage({ kind: "hay", id: h.id })}
                        className="mr-1.5 rounded-lg border border-green-700/40 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 transition hover:bg-green-100"
                      >
                        Log use
                      </button>
                      <button
                        onClick={() => setEditingHay(h)}
                        className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data.hay.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-stone-500">
                    The hay yard is empty — add your first stack, or run{" "}
                    <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> for the demo yard.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Feed inventory */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle title="Feed room" sub="Grain, supplements & minerals on hand" />
          <button onClick={() => setAddFeedOpen(true)} className="btn-primary !px-4 !py-2 text-sm">
            + Add feed item
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">On hand</th>
                <th className="py-2 pr-3">Supplier</th>
                <th className="py-2 pr-3">Cost / unit</th>
                <th className="py-2 pr-3">Alert at</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.feed.map((f) => {
                const isLow = f.quantity <= f.low_stock_threshold;
                return (
                  <tr key={f.id} className="transition hover:bg-green-50/50">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-stone-900">{f.name}</span>
                      {f.notes && <span className="block text-xs text-stone-400">{f.notes}</span>}
                    </td>
                    <td className="py-2.5 pr-3"><Badge tone="stone">{f.category}</Badge></td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <span className={`font-semibold ${isLow ? "text-red-700" : "text-stone-900"}`}>
                        {fmtQty(f.quantity, f.unit)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600">{f.supplier ?? "—"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">{fmtDollars(f.unit_cost_cents)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">{fmtQty(f.low_stock_threshold, f.unit)}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={isLow ? "red" : "green"}>{isLow ? "Low" : "In stock"}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <button
                        onClick={() => openUsage({ kind: "feed", id: f.id })}
                        className="mr-1.5 rounded-lg border border-green-700/40 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 transition hover:bg-green-100"
                      >
                        Log use
                      </button>
                      <button
                        onClick={() => setEditingFeed(f)}
                        className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data.feed.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-stone-500">
                    No feed items yet — add cubes, mineral, or grain, or run{" "}
                    <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent usage — the "where did the hay go" record */}
      <Card>
        <CardTitle title="Recent usage" sub={`${data.usage.length} entries on record · latest first`} />
        {data.usage.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing logged yet — hit “Log use” on any stack or item after feeding.
          </p>
        ) : (
          <div className="space-y-2">
            {data.usage.slice(0, 15).map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 px-3 py-2.5">
                <span className="w-20 shrink-0 text-xs font-semibold text-stone-500">{u.log_date}</span>
                <Badge tone={u.item_kind === "hay" ? "green" : "blue"}>{u.item_kind}</Badge>
                <span className="w-52 shrink-0 truncate text-sm font-medium text-stone-800">
                  {usageItemLabel(u.hay_item_id, u.feed_item_id)}
                </span>
                <span className="shrink-0 text-sm font-semibold text-stone-800">−{fmtQty(u.quantity, u.unit)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-600">
                  {u.herd_group_name ?? "—"}
                  {u.pasture ? ` · ${u.pasture}` : ""}
                  {u.notes ? ` · ${u.notes}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modals */}
      {addHayOpen || editingHay ? (
        <HayFormModal
          key={editingHay ? `edit-${editingHay.id}` : "add-hay"}
          editing={editingHay}
          onClose={() => {
            setEditingHay(null);
            setAddHayOpen(false);
          }}
          onSaved={() => {
            setEditingHay(null);
            setAddHayOpen(false);
            refresh();
          }}
        />
      ) : null}
      {addFeedOpen || editingFeed ? (
        <FeedFormModal
          key={editingFeed ? `edit-${editingFeed.id}` : "add"}
          editing={editingFeed}
          onClose={() => {
            setEditingFeed(null);
            setAddFeedOpen(false);
          }}
          onSaved={() => {
            setEditingFeed(null);
            setAddFeedOpen(false);
            refresh();
          }}
        />
      ) : null}
      {usageOpen && (
        <LogUsageModal
          hay={data.hay}
          feed={data.feed}
          groups={data.groups}
          pastures={pastures}
          preselect={usageSel}
          onClose={() => setUsageOpen(false)}
          onSaved={() => {
            setUsageOpen(false);
            refresh();
          }}
        />
      )}
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
            Feed &amp; Hay
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/livestock" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Livestock
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
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">Second real module · live database</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">Hay &amp; Feed Inventory</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            What&apos;s in the barns right now, days remaining at current usage, and who ate what — scannable from the feed truck seat.
          </p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Hay &amp; Feed module (MVP)</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
