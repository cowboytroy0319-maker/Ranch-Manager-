// ============================================================================
// Ranch Manager Pro — Expenses module types (shared client + server). All
// values are JSON-safe (dates are strings, cents are integers) so they cross
// the server/client boundary without React refusing to render.
// ============================================================================
export const EXPENSE_CATEGORIES = [
  "hay_feed",
  "livestock",
  "fuel",
  "repairs_maintenance",
  "veterinary",
  "supplies",
  "labor",
  "utilities",
  "land_pasture",
  "insurance",
  "taxes_fees",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// LEGACY CATEGORY VALUES (0007_expenses.sql) — the six values a database that
// has NOT yet had `0018_product_blocker.sql` applied can still hold:
//
//   feed, vet_health, maintenance, insurance, fuel, other
//
// They are not hypothetical: production held them until 0018 ran. A row holding
// one of them used to render with `CATEGORY_LABEL[...] === undefined` — a blank
// badge and an `undefined` React key — and the edit sheet silently showed a
// blank category and refused the save. Both are fixed here, ONCE, for every
// consumer: `categoryLabel()` is total (it can never return blank or
// `undefined`), and `canonicalExpenseCategory()` maps a legacy value to the
// canonical one 0018 writes, so the edit form round-trips it.
// ---------------------------------------------------------------------------
export const LEGACY_EXPENSE_CATEGORIES = [
  "feed",
  "vet_health",
  "maintenance",
  "insurance",
  "fuel",
  "other",
] as const;
export type LegacyExpenseCategory = (typeof LEGACY_EXPENSE_CATEGORIES)[number];

/** The exact remap `0018_product_blocker.sql` performs in SQL. Kept in step with
 *  it on purpose: the app must map a legacy value the same way the migration
 *  does, or the two disagree after a partially-applied state. */
export const LEGACY_CATEGORY_TO_CANONICAL: Record<LegacyExpenseCategory, ExpenseCategory> = {
  feed: "hay_feed",
  vet_health: "veterinary",
  maintenance: "repairs_maintenance",
  insurance: "insurance",
  fuel: "fuel",
  other: "other",
};

/** Canonical label for every value the database can hold — the twelve canonical
 *  categories AND the six legacy ones (a legacy value maps to the same display
 *  text as its canonical equivalent). Unknown values are handled by
 *  `categoryLabel()`, never by indexing this record directly. */
export const CATEGORY_LABEL: Record<ExpenseCategory | LegacyExpenseCategory, string> = {
  hay_feed: "Hay & feed",
  livestock: "Livestock",
  fuel: "Fuel",
  repairs_maintenance: "Repairs & maintenance",
  veterinary: "Veterinary",
  supplies: "Supplies",
  labor: "Labor",
  utilities: "Utilities",
  land_pasture: "Land / pasture",
  insurance: "Insurance",
  taxes_fees: "Taxes / fees",
  other: "Other",
  // Legacy (pre-0018) spellings → identical display text.
  feed: "Hay & feed",
  vet_health: "Veterinary",
  maintenance: "Repairs & maintenance",
};

export const isExpenseCategory = (value: unknown): value is ExpenseCategory =>
  typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);

export const isLegacyExpenseCategory = (value: unknown): value is LegacyExpenseCategory =>
  typeof value === "string" && (LEGACY_EXPENSE_CATEGORIES as readonly string[]).includes(value);

/** Legacy → canonical; canonical → itself; anything else → null. This is what
 *  makes the edit form (and the server write path) turn a legacy row into a
 *  canonical value instead of refusing or blanking it. */
export function canonicalExpenseCategory(value: unknown): ExpenseCategory | null {
  if (isExpenseCategory(value)) return value;
  if (isLegacyExpenseCategory(value)) return LEGACY_CATEGORY_TO_CANONICAL[value];
  return null;
}

/** `random_stuff` → "Random stuff"; empty / non-string → "Uncategorized". */
function humanizeCategory(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "Uncategorized";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * TOTAL label lookup: never blank, never the string "undefined", for ANY input
 * — canonical, legacy, NULL, empty, or a value this build has never heard of.
 * Use this everywhere a category is rendered or used as a React key.
 */
export function categoryLabel(value: unknown): string {
  if (typeof value === "string") {
    const key = value.trim();
    const known = (CATEGORY_LABEL as Record<string, string | undefined>)[key];
    if (known) return known;
    if (key) return humanizeCategory(key);
  }
  return "Uncategorized";
}

/** Ids for the canonical twelve, in display order — unique by construction, so
 *  a `<select>`/filter list built from this can never collide. */
export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] =
  EXPENSE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] }));

/**
 * The value the edit sheet's category `<select>` starts on for a STORED row.
 *
 * A row whose stored category is a LEGACY value (the six pre-0018 spellings) used
 * to leave the controlled `<select>` with no matching `<option>`: it rendered
 * BLANK and the save was refused with "Pick a category for this expense." — the
 * row could not be edited at all. Legacy values now resolve to the canonical
 * value 0018 writes (same display text), so the sheet opens on the right
 * category and saving writes a canonical value.
 *
 * A value this build cannot map is kept AS-IS (the sheet shows it with a
 * humanised label) rather than silently rewritten: the user sees what is stored
 * and chooses a real category. Only a missing/blank value falls back to the
 * default category.
 */
export function expenseFormCategory(stored: unknown): string {
  const canonical = canonicalExpenseCategory(stored);
  if (canonical) return canonical;
  if (typeof stored === "string" && stored.trim().length > 0) return stored.trim();
  return "hay_feed";
}

/** One row of a category breakdown, ready to render: a stable unique `key`, a
 *  readable `name`, and the summed amount/entries. */
export type CategoryDisplayRow = {
  key: string;
  name: string;
  amount_cents: number;
  entries: number;
};

type CategoryTotalInput = { category: string | null; amount_cents: number; entries: number };

/**
 * Category breakdown rows with NO undefined names and NO duplicate keys: rows
 * are merged by canonical identity (so a stray legacy `feed` row and a
 * canonical `hay_feed` row render as one "Hay & feed" bar instead of two rows
 * with the same label — which is also what produced the duplicate React key).
 * Rows this build cannot canonicalise keep their own keyed row and a humanised
 * label.
 */
export function categoryDisplayRows(byCategory: CategoryTotalInput[]): CategoryDisplayRow[] {
  const merged = new Map<string, CategoryDisplayRow>();
  for (const row of byCategory) {
    const canonical = canonicalExpenseCategory(row.category);
    const key = canonical ? `cat:${canonical}` : `raw:${String(row.category)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.amount_cents += row.amount_cents;
      existing.entries += row.entries;
    } else {
      merged.set(key, {
        key,
        name: categoryLabel(row.category),
        amount_cents: row.amount_cents,
        entries: row.entries,
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.amount_cents - a.amount_cents);
}

/** Total + entry count for one canonical category, counting its legacy spelling
 *  too. Without this a pre-0018 database shows "$0.00 Feed & Hay" next to a
 *  non-zero grand total — the "reads as still broken" state the verifier
 *  reproduced. */
export function categoryTotals(
  byCategory: CategoryTotalInput[],
  category: ExpenseCategory
): { amount_cents: number; entries: number } {
  let amount_cents = 0;
  let entries = 0;
  for (const row of byCategory) {
    if (canonicalExpenseCategory(row.category) !== category) continue;
    amount_cents += row.amount_cents;
    entries += row.entries;
  }
  return { amount_cents, entries };
}

/** Where a linked expense came from (the record that auto-created it). */
export const EXPENSE_SOURCES = ["restock", "pasture_activity"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const RESTOCK_TYPE = "restock";
export const PASTURE_ACTIVITY_TYPE = "pasture_activity";

/** A single expense row with joined dimension names resolved by the server so
 * the client never has to look them up. `linked` is true when the expense was
 * auto-created from a source record (hay/feed restock or pasture activity). */
export type ExpenseRow = {
  id: number;
  expense_date: string; // YYYY-MM-DD
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
  paid_by: string | null;
  source_type: ExpenseSource | null;
  source_id: number | null;
  /** True when source_type != null — display "↳ hay restock", "↳ pasture
   * activity", or "manual" for the rest. */
  linked: boolean;
  herd_group_id: number | null;
  herd_group_name: string | null;
  species: string | null;
  pasture_id: number | null;
  pasture_name: string | null;
  equipment_id: number | null;
  equipment_name: string | null;
  job: string | null;
  notes: string | null;
};
export type DimensionTotal = {
  name: string; // display label for the allocation bucket
  amount_cents: number;
  entries: number;
};
export type CategoryTotal = {
  category: ExpenseCategory;
  amount_cents: number;
  entries: number;
};
export type ExpenseData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  month: string; // YYYY-MM of the DB clock
  /** from/to filters applied (YYYY-MM-DD), or null when unfiltered (month). */
  from: string | null;
  to: string | null;
  totalCents: number;
  totalEntries: number;
  byCategory: CategoryTotal[];
  byHerd: DimensionTotal[];
  byPasture: DimensionTotal[];
  byEquipment: DimensionTotal[];
  byJob: DimensionTotal[];
  rows: ExpenseRow[]; // ascending by date
};

/** Parsed date-range + category filter for the expenses ledger. `from`/`to`
 * are inclusive YYYY-MM-DD bounds; month-scoped when both are absent. */
export type ExpenseFilter = {
  from?: string | null;
  to?: string | null;
  category?: ExpenseCategory | null;
};