// ============================================================================
// Ranch Manager Pro — Equipment, Fuel & Maintenance module types (shared
// client + server). All values are JSON-safe (dates are strings, numerics are
// JS numbers) so they cross the server/client boundary without React refusing
// to render.
// ============================================================================

export const EQUIPMENT_CATEGORIES = [
  "truck",
  "tractor",
  "trailer",
  "implement",
  "atv",
  "stationary",
  "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_STATUSES = [
  "in-service",
  "maintenance-due",
  "out-of-service",
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const CONDITIONS = ["excellent", "good", "fair", "poor"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const MAINT_TYPES = [
  "oil-change",
  "scheduled",
  "repair",
  "tire",
  "inspection",
  "other",
] as const;
export type MaintType = (typeof MAINT_TYPES)[number];

export const MAINT_STATUSES = ["done", "open"] as const;
export type MaintStatus = (typeof MAINT_STATUSES)[number];

export const FUEL_TYPES = ["diesel", "gasoline", "gas", "other"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export type EquipmentItem = {
  id: number;
  name: string;
  category: EquipmentCategory;
  make: string | null;
  model: string | null;
  year: number | null;
  hours: number | null;
  miles: number | null;
  condition: Condition | null;
  status: EquipmentStatus;
  location: string | null;
  license_plate: string | null;
  fuel_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MaintenanceRecord = {
  id: number;
  equipment_id: number;
  service_date: string; // YYYY-MM-DD
  service_type: MaintType;
  description: string | null;
  cost_cents: number | null;
  meter_hours: number | null;
  meter_miles: number | null;
  status: MaintStatus;
  next_due_date: string | null; // YYYY-MM-DD
  next_due_hours: number | null;
  next_due_miles: number | null;
  vendor: string | null;
};

export type FuelEntry = {
  id: number;
  equipment_id: number | null;
  equipment_name: string | null;
  fuel_date: string; // YYYY-MM-DD
  fuel_type: FuelType;
  gallons: number;
  cost_cents: number | null;
  price_per_gal_cents: number | null;
  meter_hours: number | null;
  meter_miles: number | null;
  location: string | null;
  notes: string | null;
};

export type EquipmentData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  equipment: EquipmentItem[];
  maintenance: MaintenanceRecord[];
  fuel: FuelEntry[]; // most recent first
};

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** Short label for an asset's meter (hours or miles) — shows whichever this
 * machine actually tracks, preferring hours for machinery and miles for rigs. */
export function meterLabel(eq: EquipmentItem): string {
  if (eq.hours != null && eq.hours > 0) return `${Math.round(eq.hours).toLocaleString()} hrs`;
  if (eq.miles != null && eq.miles > 0) return `${Math.round(eq.miles).toLocaleString()} mi`;
  return "—";
}

export function fmtDollars(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Auto-computed total cost of a fuel fill in cents: gallons × price per
 * gallon. Returns NaN while the form is still half-typed (callers show "—" for
 * NaN); never negative. */
export function fuelTotalCents(gallons: number, pricePerGal: number): number {
  if (!Number.isFinite(gallons) || !Number.isFinite(pricePerGal)) return Number.NaN;
  return Math.max(0, Math.round(gallons * pricePerGal * 100));
}

/** True when a maintenance record's next-due has been reached or passed given
 * the asset's current meter (hours/miles) or the calendar date. */
function nextDueReached(m: MaintenanceRecord, eq: EquipmentItem): boolean {
  if (m.next_due_hours != null && eq.hours != null && eq.hours >= m.next_due_hours) return true;
  if (m.next_due_miles != null && eq.miles != null && eq.miles >= m.next_due_miles) return true;
  if (m.next_due_date && YYYY_MM_DD.test(m.next_due_date) && m.next_due_date <= todayStr()) return true;
  return false;
}

export type DerivedStatus = "in-service" | "maintenance-due" | "out-of-service";

/** Digest one asset's maintenance records into an actionable status the daily
 * board can surface: out-of-service wins, then any open repair or a next-due
 * that has been reached by hours/miles/date → maintenance-due. */
export function assetStatus(eq: EquipmentItem, maint: MaintenanceRecord[]): DerivedStatus {
  if (eq.status === "out-of-service") return "out-of-service";
  const mine = maint.filter((m) => m.equipment_id === eq.id);
  const open = mine.some((m) => m.status === "open");
  const due = mine.some((m) => m.status === "done" && nextDueReached(m, eq));
  if (open || due || eq.status === "maintenance-due") return "maintenance-due";
  return "in-service";
}

export function openRepairCount(eq: EquipmentItem, maint: MaintenanceRecord[]): number {
  return maint.filter((m) => m.equipment_id === eq.id && m.status === "open").length;
}

/** Human "next service due" line for a machine, from its done records that
 * still carry a next-due target. Null when the asset has none scheduled. */
export function nextDueLabel(eq: EquipmentItem, maint: MaintenanceRecord[]): string | null {
  const mine = maint
    .filter((m) => m.equipment_id === eq.id && m.status === "done")
    .sort((a, b) => (a.service_date < b.service_date ? -1 : 1));
  for (const m of mine) {
    if (m.next_due_hours != null) return `due ${Math.round(m.next_due_hours).toLocaleString()} hrs`;
    if (m.next_due_miles != null) return `due ${Math.round(m.next_due_miles).toLocaleString()} mi`;
    if (m.next_due_date) return `due ${m.next_due_date}`;
  }
  return null;
}

export const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  truck: "Truck",
  tractor: "Tractor",
  trailer: "Trailer",
  implement: "Implement",
  atv: "ATV / UTV",
  stationary: "Stationary",
  other: "Other",
};
