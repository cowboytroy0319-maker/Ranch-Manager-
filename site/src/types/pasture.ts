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

export const SPECIES = ["cattle", "horse", "goat", "sheep"] as const;
export type Species = (typeof SPECIES)[number];

export type Pasture = {
  id: number;
  name: string;
  size_acres: number;
  location: string | null;
  status: PastureStatus;
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

export type HerdGroupRef = { id: number; name: string; species: string; notes: string | null };

export type PastureData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  pastures: Pasture[];
  assignments: PastureAssignment[];
  grazing: GrazingDay[]; // most recent first
  observations: PastureObservation[];
  groups: HerdGroupRef[];
};
