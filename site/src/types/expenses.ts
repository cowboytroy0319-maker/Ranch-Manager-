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
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
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
};

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