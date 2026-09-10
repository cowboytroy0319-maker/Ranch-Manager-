// ============================================================================
// Ranch Manager Pro — Pasture & Grazing module types (shared client + server)
// All values are JSON-safe (dates are strings, numerics are JS numbers) so
// they cross the server/client boundary without React refusing to render.
// ============================================================================

export const PASTURE_STATUSES = ["grazing", "resting", "idle", "maintenance"] as const;
export type PastureStatus = (typeof PASTURE_STATUSES)[number];

export const GRAZE_STATUSES = ["grazing", "rest"] as const;
export type GrazeStatus = (typeof GRAZE_STATUSES)[number];

export const OBSERVATION_CATEGORIES = ["forage", "water", "fence", "soil", "pest", "other"] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

/** Water availability on a paddock (default 'unknown'). */
export const WATER_STATUSES = ["good", "needs_attention", "unavailable", "unknown"] as const;
export type WaterStatus = (typeof WATER_STATUSES)[number];

/** Pasture condition (default 'good'). */
export const PASTURE_CONDITIONS = ["excellent", "good", "fair", "poor", "resting"] as const;
export type PastureCondition = (typeof PASTURE_CONDITIONS)[number];

/** Kinds of pasture work an activity record can carry (10 types). */
export const ACTIVITY_TYPES = [
  "fencing",
  "water_system",
  "mowing",
  "fertilizing",
  "spraying",
  "reseeding",
  "mineral_salt",
  "repair",
  "inspection",
  "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  fencing: "Fencing",
  water_system: "Water system",
  mowing: "Mowing / clipping",
  fertilizing: "Fertilizing",
  spraying: "Spraying",
  reseeding: "Reseeding / frost seed",
  mineral_salt: "Mineral / salt",
  repair: "Repair",
  inspection: "Inspection",
  other: "Other",
};

export const SPECIES = ["cattle", "horse", "goat", "sheep"] as const;
export type Species = (typeof SPECIES)[number];

export type Pasture = {
  id: number;
  name: string;
  size_acres: number | null; // optional; >0 when present
  location: string | null;
  status: PastureStatus;
  pasture_type: string | null; // free-text use (hay ground, native, trap…)
  capacity_heads: number | null; // NULL or >= 0
  water_status: WaterStatus;
  condition: PastureCondition;
  soil_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** A pasture assignment, joined to its herd group (for name + species).
 * `ended_at === null` marks the CURRENT assignment. */
export type PastureAssignment = {
  id: number;
  pasture_id: number;
  herd_group_id: number | null;
  herd_group_name: string | null;
  species: Species | null;
  assigned_at: string; // YYYY-MM-DD
  target_grazing_days: number | null;
  ended_at: string | null; // null = active
  notes: string | null;
};

export type GrazingDay = {
  id: number;
  pasture_id: number;
  log_date: string; // YYYY-MM-DD
  status: GrazeStatus;
  notes: string | null;
};

export type PastureObservation = {
  id: number;
  pasture_id: number;
  observed_on: string; // YYYY-MM-DD
  category: ObservationCategory;
  note: string | null;
  action_due: string | null;
};

/** A record of work done on a pasture — optionally carries cost and (when the
 * operator asked) creates ONE linked land/pasture expense. */
export type PastureActivity = {
  id: number;
  pasture_id: number;
  activity_date: string; // YYYY-MM-DD
  activity_type: ActivityType;
  cost_cents: number | null; // NULL or >= 0
  notes: string | null;
  created_at: string;
};

/** A group-based livestock move between paddocks. from_pasture_id is NULL
 * when the group came from off-pasture/unknown. */
export type LivestockMovement = {
  id: number;
  from_pasture_id: number | null;
  to_pasture_id: number;
  move_date: string; // YYYY-MM-DD
  herd_group_id: number | null;
  herd_group_name: string | null;
  head_count: number | null; // NULL or >= 0
  notes: string | null;
  created_at: string;
};

export type HerdGroupRef = { id: number; name: string; species: string; notes: string | null };

export type PastureData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  pastures: Pasture[];
  assignments: PastureAssignment[];
  grazing: GrazingDay[]; // most recent first
  observations: PastureObservation[];
  activities: PastureActivity[]; // most recent first
  movements: LivestockMovement[]; // most recent first
  groups: HerdGroupRef[];
};