// ============================================================================
// Ranch Manager Pro — Livestock module types (shared client + server)
// All values are JSON-safe (dates are strings) so they cross the server/client
// boundary without React refusing to render them.
// ============================================================================

export const SPECIES = ["cattle", "horse", "goat", "sheep"] as const;
export type Species = (typeof SPECIES)[number];

export const ANIMAL_STATUSES = [
  "active",
  "pending",
  "sold",
  "deceased",
  "culled",
  "archived",
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export const HEALTH_EVENT_TYPES = [
  "vaccination",
  "treatment",
  "inspection",
  "injury",
  "other",
] as const;
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number];

export const SEXES = ["female", "male", "castrated"] as const;
export type Sex = (typeof SEXES)[number];

export type HerdGroup = {
  id: number;
  name: string;
  species: Species;
  notes: string | null;
};

export type Animal = {
  id: number;
  species: Species;
  name: string;
  tag_number: string | null;
  /** The ranch/operation this animal belongs to (scoping key for tag
   * uniqueness and, later, multi-ranch accounting). NULL only in the
   * no-DB/unconfigured state — the server always writes it. */
  ranch_id: number | null;
  sex: Sex | null;
  breed: string | null;
  birth_date: string | null; // YYYY-MM-DD
  acquisition_date: string | null; // YYYY-MM-DD
  status: AnimalStatus;
  herd_group_id: number | null;
  herd_group_name: string | null;
  pasture: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type HealthEvent = {
  id: number;
  animal_id: number;
  event_date: string; // YYYY-MM-DD
  type: HealthEventType;
  description: string | null;
  product: string | null;
  dosage: string | null;
  vet: string | null;
  withdrawal_days: number | null;
  next_due: string | null; // YYYY-MM-DD
};

/** Health events due within the next N days surface on the overview. */
export const UPCOMING_WINDOW_DAYS = 30;

export type LivestockData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  animals: Animal[];
  groups: HerdGroup[];
  events: HealthEvent[]; // health events for animals with next_due upcoming
};
