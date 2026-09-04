// ============================================================================
// Ranch Manager Pro — Pasture & Grazing server functions (the only place that
// talks to the database for this module). Import only from route files; the
// handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import {
  PASTURE_STATUSES,
  type HerdGroupRef,
  type Pasture,
  type PastureAssignment,
  type PastureData,
  type PastureObservation,
  type GrazingDay,
} from "~/types/pasture";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getPastureData = createServerFn().handler(async (): Promise<PastureData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, pastures: [], assignments: [], grazing: [], observations: [], groups: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const [pastureRows, assignmentRows, grazingRows, obsRows, groupRows] = await Promise.all([
      db`
        SELECT id, name, size_acres, location, status, soil_type, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM pastures
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT pa.id, pa.pasture_id, pa.herd_group_id, g.name AS herd_group_name, g.species,
               to_char(pa.assigned_at, 'YYYY-MM-DD') AS assigned_at,
               pa.target_grazing_days,
               to_char(pa.ended_at, 'YYYY-MM-DD') AS ended_at,
               pa.notes
        FROM pasture_assignments pa
        LEFT JOIN herd_groups g ON g.id = pa.herd_group_id
        WHERE pa.operation_id = ${auth.operationId}
        ORDER BY pa.assigned_at DESC, pa.id DESC`,
      db`
        SELECT id, pasture_id, to_char(log_date, 'YYYY-MM-DD') AS log_date, status, notes
        FROM grazing_log
        WHERE operation_id = ${auth.operationId}
        ORDER BY log_date DESC, id DESC`,
      db`
        SELECT id, pasture_id, to_char(observed_on, 'YYYY-MM-DD') AS observed_on, category, note,
               to_char(action_due, 'YYYY-MM-DD') AS action_due
        FROM pasture_observations
        WHERE operation_id = ${auth.operationId}
        ORDER BY observed_on DESC, id DESC`,
      db`
        SELECT id, name, species, notes FROM herd_groups
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
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

// ---------------------------------------------------------------------------
// Validation helpers (plain, no schema library — mirrors livestock.ts)
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** Positive decimal with a strict >0 check (acres must be real, never zero). */
const positiveDecimal = (v: unknown, field: string): number => {
  if (v === null || v === undefined || v === "") throw new Error(`${field} is required.`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`);
  if (n <= 0) throw new Error(`${field} must be greater than zero.`);
  return n;
};

const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export type PastureInput = {
  id?: number;
  name: string;
  size_acres: number;
  location: string | null;
  status: Pasture["status"];
  soil_type: string | null;
  notes: string | null;
};

export function parsePastureInput(raw: unknown): PastureInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  if (!name) throw new Error("Pasture name is required.");
  if (name.length > 200) throw new Error("Pasture name is too long (max 200 characters).");
  const id = optionalInt(d.id);
  return {
    id: id === null ? undefined : id,
    name,
    size_acres: positiveDecimal(d.size_acres, "Acreage"),
    location: str(d.location),
    status: oneOf(d.status, PASTURE_STATUSES) ?? "resting",
    soil_type: str(d.soil_type),
    notes: str(d.notes),
  };
}

// ---------------------------------------------------------------------------
// Write: save pasture (insert or update)
// ---------------------------------------------------------------------------

export const savePasture = createServerFn({ method: "POST" })
  .validator(parsePastureInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const p = data;
      if (p.id) {
        const updated = await db`
          UPDATE pastures SET name=${p.name}, size_acres=${p.size_acres}, location=${p.location},
            status=${p.status}, soil_type=${p.soil_type}, notes=${p.notes}, updated_at=now()
          WHERE id=${p.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Pasture #${p.id} no longer exists in this ranch.` };
        return { ok: true, id: p.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO pastures (operation_id, name, size_acres, location, status, soil_type, notes)
        VALUES (${auth.operationId}, ${p.name}, ${p.size_acres}, ${p.location}, ${p.status}, ${p.soil_type}, ${p.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
