// ============================================================================
// Ranch Manager Pro — Pasture & Grazing server functions (the only place that
// talks to the database for this module). Import only from route files; the
// handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import type {
  GrazingDay,
  HerdGroupRef,
  PastureAssignment,
  PastureData,
  PastureObservation,
} from "~/types/pasture";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getPastureData = createServerFn().handler(async (): Promise<PastureData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, pastures: [], assignments: [], grazing: [], observations: [], groups: [] };
  }
  try {
    const db = sql();
    const [pastureRows, assignmentRows, grazingRows, obsRows, groupRows] = await Promise.all([
      db`
        SELECT id, name, size_acres, location, status, soil_type, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM pastures
        ORDER BY name`,
      db`
        SELECT pa.id, pa.pasture_id, pa.herd_group_id, g.name AS herd_group_name, g.species,
               to_char(pa.assigned_at, 'YYYY-MM-DD') AS assigned_at,
               pa.target_grazing_days,
               to_char(pa.ended_at, 'YYYY-MM-DD') AS ended_at,
               pa.notes
        FROM pasture_assignments pa
        LEFT JOIN herd_groups g ON g.id = pa.herd_group_id
        ORDER BY pa.assigned_at DESC, pa.id DESC`,
      db`
        SELECT id, pasture_id, to_char(log_date, 'YYYY-MM-DD') AS log_date, status, notes
        FROM grazing_log
        ORDER BY log_date DESC, id DESC`,
      db`
        SELECT id, pasture_id, to_char(observed_on, 'YYYY-MM-DD') AS observed_on, category, note,
               to_char(action_due, 'YYYY-MM-DD') AS action_due
        FROM pasture_observations
        ORDER BY observed_on DESC, id DESC`,
      db`SELECT id, name, species, notes FROM herd_groups ORDER BY name`,
    ]);

    return {
      configured: true,
      pastures: pastureRows as unknown as PastureData["pastures"],
      assignments: assignmentRows as unknown as PastureAssignment[],
      grazing: grazingRows as unknown as GrazingDay[],
      observations: obsRows as unknown as PastureObservation[],
      groups: groupRows as unknown as HerdGroupRef[],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      pastures: [],
      assignments: [],
      grazing: [],
      observations: [],
      groups: [],
    };
  }
});
