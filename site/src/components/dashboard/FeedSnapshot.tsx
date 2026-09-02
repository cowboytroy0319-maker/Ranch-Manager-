import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle, ProgressBar, Stat } from "~/components/ui";
import { FEED_SNAPSHOT } from "~/data/sample";
import {
  USAGE_RATE_WINDOW_DAYS,
  fmtQty,
  hayDaysLeftForItem,
  hayDaysLeftOverall,
  hayTons,
  lowStockItems,
  type FeedData,
} from "~/types/feed";

const totalBales = FEED_SNAPSHOT.filter((f) => f.unit === "bales").reduce((s, f) => s + f.onHand, 0);
const low = FEED_SNAPSHOT.filter((f) => f.onHand < f.reorderAt);

/**
 * "Feed & hay" panel on the Daily Ops dashboard. When the database is
 * configured and readable, `data` carries the real hay yard; otherwise the
 * panel falls back to the sample-data view it has always shown.
 */
export function FeedSnapshot({ data }: { data?: FeedData }) {
  const live = data && data.configured && !data.error && (data.hay.length > 0 || data.feed.length > 0 || data.usage.length > 0);
  if (!live) return <SampleFeedSnapshot />;

  const hay = data!.hay;
  const feed = data!.feed;
  const usage = data!.usage;
  const bales = hay.filter((h) => h.unit === "bales").reduce((s, h) => s + h.quantity, 0);
  const tons = hay.reduce((s, h) => s + hayTons(h), 0);
  const daysLeft = hayDaysLeftOverall(hay, usage);
  const lowItems = lowStockItems(hay, feed);
  // Priority rows: low-stock stacks first, then by days left.
  const rows = [...hay]
    .sort((a, b) => {
      const aLow = a.quantity <= a.low_stock_threshold ? 0 : 1;
      const bLow = b.quantity <= b.low_stock_threshold ? 0 : 1;
      if (aLow !== bLow) return aLow - bLow;
      const aDays = hayDaysLeftForItem(a, usage) ?? Infinity;
      const bDays = hayDaysLeftForItem(b, usage) ?? Infinity;
      return aDays - bDays;
    })
    .slice(0, 5);

  return (
    <Card>
      <CardTitle
        title="Feed & hay"
        sub={`Live records · ${USAGE_RATE_WINDOW_DAYS}-day usage rate`}
        right={<Link to="/feed" className="shrink-0 rounded-lg border border-green-700/40 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800 transition hover:bg-green-100">Open Feed &amp; Hay →</Link>}
      />
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Hay bales on hand" value={Math.round(bales).toLocaleString()} sub={`${Math.round(tons).toLocaleString()} est. tons total`} accent />
        <Stat label="Low-stock alerts" value={String(lowItems.length)} sub={lowItems.length ? "order now" : "all stocked"} />
        <Stat
          label="Days of hay left"
          value={daysLeft != null ? `~${daysLeft}` : "—"}
          sub={daysLeft != null ? "on current usage" : "log usage to project"}
        />
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((h) => {
          const isLow = h.quantity <= h.low_stock_threshold;
          const days = hayDaysLeftForItem(h, usage);
          return (
            <div key={h.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-stone-800">
                    {h.feed_type[0].toUpperCase() + h.feed_type.slice(1)}
                    {h.cutting ? ` · ${h.cutting} cutting` : ""}
                    {h.field_or_source ? ` — ${h.field_or_source}` : ""}
                  </p>
                  <p className="text-xs text-stone-500">
                    {fmtQty(h.quantity, h.unit)} on hand ·{" "}
                    {days != null ? `~${days} days left` : "no recent use"} · {h.storage_location ?? "—"}
                  </p>
                </div>
                {isLow ? <Badge tone="red">Reorder now</Badge> : <Badge tone="green">In stock</Badge>}
              </div>
              <div className="mt-2">
                <ProgressBar value={h.quantity} max={Math.max(h.quantity, h.low_stock_threshold * 1.5)} color={isLow ? "#b91c1c" : "#5a7d3a"} />
              </div>
            </div>
          );
        })}
      </div>
      {lowItems.some((x) => x.kind === "feed") && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Feed room also low:{" "}
          {lowItems
            .filter((x) => x.kind === "feed")
            .map((x) => `${(x.item as { name: string }).name} (${fmtQty(x.item.quantity, x.item.unit)})`)
            .join(", ")}
        </p>
      )}
      <p className="mt-3 text-xs text-stone-400">
        Days remaining are projected from the last {USAGE_RATE_WINDOW_DAYS} days of logged use vs. what&apos;s in the yard. Details and logging on the{" "}
        <Link to="/feed" className="font-semibold text-green-700 hover:text-green-900">Feed &amp; Hay</Link> page.
      </p>
    </Card>
  );
}

function SampleFeedSnapshot() {
  return (
    <Card>
      <CardTitle title="Feed & hay" sub="Days remaining on current stock · low-stock alerts" />
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Hay bales on hand" value={String(totalBales)} sub={`${low.length} below reorder`} accent />
        <Stat label="Low-stock alerts" value={String(low.length)} sub="order now" />
        <Stat label="Coastal days left" value="~88" sub="on current usage" />
      </div>
      <div className="mt-4 space-y-3">
        {FEED_SNAPSHOT.map((f) => {
          const isLow = f.onHand < f.reorderAt;
          const days = f.monthlyUse > 0 ? Math.round((f.onHand / f.monthlyUse) * 30) : null;
          return (
            <div key={f.item} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-stone-800">{f.item}</p>
                  <p className="text-xs text-stone-500">{f.onHand} {f.unit} on hand · {days !== null ? `~${days} days left` : "no monthly use"} · {f.recentUsage}</p>
                </div>
                {isLow ? <Badge tone="red">Reorder now</Badge> : <Badge tone="green">In stock</Badge>}
              </div>
              <div className="mt-2">
                <ProgressBar value={f.onHand} max={f.reorderAt * 1.5} color={isLow ? "#b91c1c" : "#5a7d3a"} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-stone-400">Days remaining are projected from current on-hand levels vs. monthly use. Coastal stays stocked; alfalfa is the reorder priority today. <Link to="/feed" className="font-semibold text-green-700 hover:text-green-900">Open Feed &amp; Hay →</Link></p>
    </Card>
  );
}
