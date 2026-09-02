// ============================================================================
// Ranch Manager Pro — Hay & Feed module types (shared client + server)
// All values are JSON-safe (dates are strings, numerics are JS numbers) so
// they cross the server/client boundary without React refusing to render.
// ============================================================================

export const HAY_TYPES = ["grass", "alfalfa", "mixed", "other"] as const;
export type HayType = (typeof HAY_TYPES)[number];

export const FEED_CATEGORIES = [
  "grain",
  "supplement",
  "mineral",
  "hay-substitute",
  "other",
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export const HAY_UNITS = ["bales", "tons"] as const;
export type HayUnit = (typeof HAY_UNITS)[number];

export const FEED_UNITS = ["lbs", "bags", "tons"] as const;
export type FeedUnit = (typeof FEED_UNITS)[number];

/** Units a usage entry can be logged in (constrained to the item's own unit). */
export type UsageUnit = HayUnit | FeedUnit;

export type HayItem = {
  id: number;
  feed_type: HayType;
  cutting: string | null;
  field_or_source: string | null;
  storage_location: string | null;
  quantity: number;
  unit: HayUnit;
  bale_weight_lbs: number | null;
  date_acquired: string | null; // YYYY-MM-DD
  low_stock_threshold: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FeedItem = {
  id: number;
  name: string;
  category: FeedCategory;
  quantity: number;
  unit: FeedUnit;
  supplier: string | null;
  unit_cost_cents: number | null;
  low_stock_threshold: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type UsageEntry = {
  id: number;
  log_date: string; // YYYY-MM-DD
  item_kind: "hay" | "feed";
  hay_item_id: number | null;
  feed_item_id: number | null;
  quantity: number;
  unit: string;
  herd_group_id: number | null;
  herd_group_name: string | null;
  pasture: string | null;
  notes: string | null;
  created_at: string;
};

export type FeedData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  hay: HayItem[];
  feed: FeedItem[];
  groups: HerdGroupRef[];
  usage: UsageEntry[]; // most recent first
};

/** Minimal herd-group reference (full type lives in types/livestock). */
export type HerdGroupRef = { id: number; name: string; species: string; notes: string | null };

/** How many days of recent usage drive the "days remaining" estimate. */
export const USAGE_RATE_WINDOW_DAYS = 14;

/** Assumed bale weight (lbs) when a bale-counted stack has no weight recorded. */
export const DEFAULT_BALE_LBS = 60;

/** Tons in a pound. */
const LBS_PER_TON = 2000;

/** Convert a hay stack to short tons. Bale-counted stacks use the recorded
 * bale weight (or a 60 lb default); ton-counted stacks are already tons. */
export function hayTons(item: HayItem): number {
  if (item.unit === "tons") return item.quantity;
  const lbs = item.bale_weight_lbs && item.bale_weight_lbs > 0 ? item.bale_weight_lbs : DEFAULT_BALE_LBS;
  return (item.quantity * lbs) / LBS_PER_TON;
}

/** Short label for a quantity + unit, e.g. "640 bales" / "4.5 tons". */
export function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toLocaleString() : qty.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${n} ${unit}`;
}

export function fmtDollars(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Estimated days a hay stack lasts at its own recent usage rate.
 * Returns null when there's no usage to project from. */
export function hayDaysLeftForItem(
  item: HayItem,
  usage: UsageEntry[],
  windowDays = USAGE_RATE_WINDOW_DAYS
): number | null {
  const used = usage
    .filter((u) => u.item_kind === "hay" && u.hay_item_id === item.id)
    .reduce((s, u) => {
      if (u.unit === "tons") return s + u.quantity;
      const lbs = item.bale_weight_lbs && item.bale_weight_lbs > 0 ? item.bale_weight_lbs : DEFAULT_BALE_LBS;
      return s + (u.quantity * lbs) / LBS_PER_TON;
    }, 0);
  const perDay = used / windowDays;
  if (perDay <= 0) return null;
  return Math.floor(hayTons(item) / perDay);
}

/** Whole-yard estimate: total tons on hand ÷ average daily hay usage over the
 * recent window. Returns null when no hay usage has been logged yet. */
export function hayDaysLeftOverall(
  hay: HayItem[],
  usage: UsageEntry[],
  windowDays = USAGE_RATE_WINDOW_DAYS
): number | null {
  const tonsOnHand = hay.reduce((s, item) => s + hayTons(item), 0);
  const hayById = new Map(hay.map((h) => [h.id, h]));
  const usedTons = usage
    .filter((u) => u.item_kind === "hay" && u.hay_item_id != null)
    .reduce((s, u) => {
      const item = hayById.get(u.hay_item_id!);
      if (!item) return s; // deleted stack — skip
      if (u.unit === "tons") return s + u.quantity;
      const lbs = item.bale_weight_lbs && item.bale_weight_lbs > 0 ? item.bale_weight_lbs : DEFAULT_BALE_LBS;
      return s + (u.quantity * lbs) / LBS_PER_TON;
    }, 0);
  const perDay = usedTons / windowDays;
  if (perDay <= 0) return null;
  return Math.floor(tonsOnHand / perDay);
}

/** Items at/below their low-stock threshold (hay + feed together). */
export function lowStockItems(hay: HayItem[], feed: FeedItem[]): { kind: "hay" | "feed"; item: HayItem | FeedItem }[] {
  const out: { kind: "hay" | "feed"; item: HayItem | FeedItem }[] = [];
  for (const h of hay) if (h.quantity <= h.low_stock_threshold) out.push({ kind: "hay", item: h });
  for (const f of feed) if (f.quantity <= f.low_stock_threshold) out.push({ kind: "feed", item: f });
  return out;
}
