import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { getAnalyticsData } from "~/server/analytics";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";

export const Route = createFileRoute("/analytics")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getAnalyticsData(),
});

function AnalyticsPage() {
  const data = Route.useLoaderData();

  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="📊 Database not configured"
            sub="Site analytics persist to Postgres — no connection string is set in this environment."
          />
          <p className="text-sm text-amber-800">
            Once a database is connected, <code>db:migrate</code> creates the{" "}
            <code>page_views</code> table and this page will show total views, unique
            visitors, daily activity, and top pages.
          </p>
        </Card>
      </Shell>
    );
  }

  const pct = (n: number) =>
    data.totalViews > 0 ? Math.round((n / data.totalViews) * 100) : 0;
  const maxDay = Math.max(1, ...data.last7Days.map((d) => d.views));
  const empty = data.totalViews === 0;

  return (
    <Shell>
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total views" value={data.totalViews.toLocaleString()} sub="all time" accent />
        <Stat label="Unique visitors" value={data.uniqueVisitors.toLocaleString()} sub="distinct visitor_ids" />
        <Stat label="Views today" value={data.viewsToday.toLocaleString()} sub="current day" />
        <Stat label="Days tracked" value={String(data.last7Days.filter((d) => d.views > 0).length)} sub="last 7 days" />
      </div>

      {empty && (
        <Card className="border-green-200 bg-green-50/40">
          <CardTitle title="No views recorded yet" sub="This is a fresh deployment." />
          <p className="text-sm text-stone-600">
            Load any page in a browser and the in-page beacon will record the first
            view here automatically — no setup or third-party service required.
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Last 7 days */}
        <Card>
          <CardTitle title="Last 7 days" sub="Views and unique visitors per day" right={<Badge tone="green">Real data</Badge>} />
          {data.last7Days.length ? (
            <div className="space-y-3">
              {data.last7Days.map((d) => (
                <div key={d.date}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-stone-600">{d.date}</span>
                    <span className="text-stone-500">
                      <span className="font-semibold text-stone-800">{d.views}</span> views ·{" "}
                      <span className="font-semibold text-stone-800">{d.unique}</span> unique
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-green-700"
                      style={{ width: `${(d.views / maxDay) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No daily data yet.</p>
          )}
        </Card>

        {/* Top pages */}
        <Card>
          <CardTitle title="Top pages" sub="Most-viewed paths" right={<Badge tone="blue">{data.byPage.length} shown</Badge>} />
          {data.byPage.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-3">Page</th>
                    <th className="py-2 pr-3 text-right">Views</th>
                    <th className="py-2 pr-3 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.byPage.map((p) => (
                    <tr key={p.label} className="transition hover:bg-green-50/50">
                      <td className="py-2.5 pr-3 font-medium text-stone-800">{p.label}</td>
                      <td className="py-2.5 pr-3 text-right text-stone-700">{p.views}</td>
                      <td className="py-2.5 pr-3 text-right text-stone-500">{pct(p.views)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-stone-500">No pages recorded yet.</p>
          )}
        </Card>
      </div>

      {/* Referrers */}
      <Card>
        <CardTitle title="Referrers" sub="Where visitors came from (direct = typed or bookmarked)" right={<Badge tone="amber">{data.referrers.length} sources</Badge>} />
        {data.referrers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Views</th>
                  <th className="py-2 pr-3 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.referrers.map((r) => (
                  <tr key={r.label} className="transition hover:bg-green-50/50">
                    <td className="py-2.5 pr-3 font-medium text-stone-800">{r.label}</td>
                    <td className="py-2.5 pr-3 text-right text-stone-700">{r.views}</td>
                    <td className="py-2.5 pr-3 text-right text-stone-500">{pct(r.views)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-stone-500">No referrer data yet.</p>
        )}
      </Card>

      <p className="text-xs text-stone-400">
        {data.error ? `Analytics error: ${data.error}` : "Self-hosted page-view analytics — no third-party service."}{" "}
        Series max: {maxDay} views in a day.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      badge="Site Analytics"
      eyebrow="Self-hosted analytics"
      title="Site Analytics"
      subtitle="Page views, unique visitors, top pages, and referrers — collected and served from our own database, no third-party tracker."
    >
      {children}
    </AppShell>
  );
}
