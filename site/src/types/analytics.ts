// ============================================================================
// Ranch Manager Pro — Site analytics types (shared client + server). All
// values are JSON-safe (dates are strings, counts are integers) so they cross
// the server/client boundary without React refusing to render.
// ============================================================================
/** One day in the last-7-days series. */
export type AnalyticsDay = {
  date: string; // YYYY-MM-DD
  views: number;
  unique: number; // distinct visitor_id for that day
};

/** A per-page or per-referrer total. */
export type AnalyticsBucket = {
  label: string; // page path or referrer host
  views: number;
};

export type AnalyticsData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  totalViews: number;
  uniqueVisitors: number;
  viewsToday: number;
  last7Days: AnalyticsDay[]; // oldest → newest, last 7 calendar days
  byPage: AnalyticsBucket[]; // top pages, descending by views
  referrers: AnalyticsBucket[]; // top referrers, descending by views
};
