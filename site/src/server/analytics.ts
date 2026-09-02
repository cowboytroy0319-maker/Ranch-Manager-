// ============================================================================
// Ranch Manager Pro — Self-hosted site analytics (server-only).
// All DB access lives here behind createServerFn handlers guarded with
// isDatabaseConfigured(). No third-party analytics service: page views are
// recorded fire-and-forget into our own `page_views` table and read back by the
// admin /analytics page. Handlers never throw to the client — they return
// JSON-safe data or a safe no-op.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import type { AnalyticsBucket, AnalyticsData, AnalyticsDay } from "~/types/analytics";

// Number of pages shown in the "top pages" list.
const TOP_N = 10;

type PageViewInput = {
  path: string;
  visitorId: string;
  referrer?: string | null;
  userAgent?: string | null;
};

// ---------------------------------------------------------------------------
// Write: record one page view (fire-and-forget beacon)
// ---------------------------------------------------------------------------
export const recordPageView = createServerFn({ method: "POST" })
  .validator((d: PageViewInput) => d)
  .handler(
    async ({ data }): Promise<{ ok: boolean }> => {
      // No-op when the database isn't connected — the beacon should never break
      // navigation, so unconfigured/errors always resolve to { ok: false }.
      if (!isDatabaseConfigured()) return { ok: false };
      const path = String(data.path || "/").slice(0, 500);
      const visitorId = String(data.visitorId || "unknown").slice(0, 200);
      if (!path || !visitorId) return { ok: false };
      try {
        const db = sql();
        await db`
          INSERT INTO page_views (path, visitor_id, referrer, user_agent)
          VALUES (
            ${path},
            ${visitorId},
            ${data.referrer && String(data.referrer).trim() ? String(data.referrer).slice(0, 1000) : null},
            ${data.userAgent && String(data.userAgent).trim() ? String(data.userAgent).slice(0, 500) : null}
          )`;
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }
  );

// ---------------------------------------------------------------------------
// Read: aggregates for the /analytics admin page
// ---------------------------------------------------------------------------
export const getAnalyticsData = createServerFn().handler(
  async (): Promise<AnalyticsData> => {
    if (!isDatabaseConfigured()) {
      return {
        configured: false,
        totalViews: 0,
        uniqueVisitors: 0,
        viewsToday: 0,
        last7Days: [],
        byPage: [],
        referrers: [],
      };
    }
    try {
      const db = sql();
      const [total, today, unique, last7, byPage, referrers] = await Promise.all([
        db<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM page_views`,
        db<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM page_views WHERE created_at::date = current_date`,
        db<{ c: number }[]>`SELECT COUNT(DISTINCT visitor_id)::int AS c FROM page_views`,
        db<AnalyticsDay[]>`
          SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                 coalesce(COUNT(p.id), 0)::int               AS views,
                 COUNT(DISTINCT p.visitor_id)::int           AS unique
          FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') AS d(day)
          LEFT JOIN page_views p ON p.created_at::date = d.day
          GROUP BY d.day
          ORDER BY d.day`,
        db<AnalyticsBucket[]>`
          SELECT path AS label, COUNT(*)::int AS views
          FROM page_views
          GROUP BY path
          ORDER BY views DESC
          LIMIT ${TOP_N}`,
        db<AnalyticsBucket[]>`
          SELECT coalesce(nullif(nullif(referrer, ''), '(none)'), '(direct)') AS label,
                 COUNT(*)::int AS views
          FROM page_views
          GROUP BY 1
          ORDER BY views DESC
          LIMIT ${TOP_N}`,
      ]);
      return {
        configured: true,
        totalViews: total[0]?.c ?? 0,
        uniqueVisitors: unique[0]?.c ?? 0,
        viewsToday: today[0]?.c ?? 0,
        last7Days: last7 as AnalyticsDay[],
        byPage: byPage as AnalyticsBucket[],
        referrers: referrers as AnalyticsBucket[],
      };
    } catch (err) {
      return {
        configured: true,
        error: err instanceof Error ? err.message : String(err),
        totalViews: 0,
        uniqueVisitors: 0,
        viewsToday: 0,
        last7Days: [],
        byPage: [],
        referrers: [],
      };
    }
  }
);
