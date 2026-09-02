// ============================================================================
// Ranch Manager Pro — Expenses module types (shared client + server). All
// values are JSON-safe (dates are strings, cents are integers) so they cross
// the server/client boundary without React refusing to render.
// ============================================================================
export const EXPENSE_CATEGORIES = [
  "feed",
  "vet_health",
  "maintenance",
  "insurance",
  "fuel",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  feed: "Feed & Hay",
  vet_health: "Vet & Health",
  maintenance: "Maintenance",
  insurance: "Insurance",
  fuel: "Fuel",
  other: "Other",
};
/** A single current-month expense row with joined dimension names resolved by
 * the server so the client never has to look them up. */
export type ExpenseRow = {
  id: number;
  expense_date: string; // YYYY-MM-DD
  category: ExpenseCategory;
  amount_cents: number;
  vendor: string | null;
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
  month: string; // YYYY-MM of the current month (DB clock)
  totalCents: number;
  totalEntries: number;
  byCategory: CategoryTotal[];
  byHerd: DimensionTotal[];
  byPasture: DimensionTotal[];
  byEquipment: DimensionTotal[];
  byJob: DimensionTotal[];
  rows: ExpenseRow[]; // current month, ascending by date
};
