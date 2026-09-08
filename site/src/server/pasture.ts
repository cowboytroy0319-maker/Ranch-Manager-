// ============================================================================
// Ranch Manager Pro — Pasture & Grazing server functions (the only place that
// talks to the database for this module). Import only from route files; the
// handlers run on the server and return JSON-safe data.
//
// Movement model (honest): the app tracks grazing by herd GROUP via
// `pasture_assignments` (herd_group_id → pasture_id, ended_at IS NULL for the
// current one) — animals themselves carry a free-text `pasture`, NOT a pasture
// FK. So moveLivestock closes one group's active assignment, opens the next,
// and writes a livestock_movements history row. This is documented in
// docs/PASTURE_OPERATIONS.md.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import {
  ACTIVITY_TYPES,
  PASTURE_CONDITIONS,
  PASTURE_STATUSES,
  WATER_STATUSES,
  type ActivityType,
  type HerdGroupRef,
  type LivestockMovement,
  type Pasture,
  type PastureActivity,
  type PastureAssignment,
  type PastureData,
  type PastureObservation,
  type GrazingDay,
} from "~/types/pasture";
import { insertLinkedExpense } from "./feed";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getPastureData = createServerFn().handler(async (): Promise<PastureData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, pastures: [], assignments: [], grazing: [], observations: [], activities: [], movements: [], groups: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const [pastureRows, assignmentRows, grazingRows, obsRows, activityRows, moveRows, groupRows] = await Promise.all([
      db`
        SELECT id, name, size_acres, location, status, pasture_type, capacity_heads,
               water_status, condition, soil_type, notes,
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
        SELECT id, pasture_id, to_char(activity_date, 'YYYY-MM-DD') AS activity_date,
               activity_type, cost_cents, notes, created_at::text AS created_at
        FROM pasture_activities
        WHERE operation_id = ${auth.operationId}
        ORDER BY activity_date DESC, id DESC`,
      db`
        SELECT lm.id, lm.from_pasture_id, lm.to_pasture_id,
               to_char(lm.move_date, 'YYYY-MM-DD') AS move_date,
               lm.herd_group_id, g.name AS herd_group_name, lm.head_count, lm.notes,
               lm.created_at::text AS created_at
        FROM livestock_movements lm
        LEFT JOIN herd_groups g ON g.id = lm.herd_group_id
        WHERE lm.operation_id = ${auth.operationId}
        ORDER BY lm.move_date DESC, lm.id DESC
        LIMIT 200`,
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
      activities: activityRows as unknown as PastureActivity[],
      movements: moveRows as unknown as LivestockMovement[],
      groups: groupRows as unknown as HerdGroupRef[],
    };
  } catch (err) {
    console.error("getPastureData failed:", err);
    return {
      configured: true,
      error: "We couldn't load your pasture records right now. Please refresh and try again.",
      pastures: [],
      assignments: [],
      grazing: [],
      observations: [],
      activities: [],
      movements: [],
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

/** Positive decimal with a strict >0 check when present (acres must be real,
 *  never zero); blank is allowed now (size_acres became optional). */
const optionalPositiveDecimal = (v: unknown, field: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`);
  if (n <= 0) throw new Error(`${field} must be greater than zero.`);
  if (n > 99999) throw new Error(`${field} looks too large — check the number and try again.`);
  return n;
};

const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  return s;
};

export type PastureInput = {
  id?: number;
  name: string;
  size_acres: number | null;
  location: string | null;
  status: Pasture["status"];
  pasture_type: string | null;
  capacity_heads: number | null;
  water_status: Pasture["water_status"];
  condition: Pasture["condition"];
  soil_type: string | null;
  notes: string | null;
};

export function parsePastureInput(raw: unknown): PastureInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  if (!name) throw new Error("Pasture name is required.");
  if (name.length > 200) throw new Error("Pasture name is too long (max 200 characters).");
  const capacity = optionalInt(d.capacity_heads);
  if (capacity !== null && capacity < 0) throw new Error("Capacity can't be negative.");
  return {
    id: optionalInt(d.id) === null ? undefined : optionalInt(d.id) ?? undefined,
    name,
    size_acres: optionalPositiveDecimal(d.size_acres, "Acreage"),
    location: str(d.location),
    status: parseStatusOrThrow(d.status, PASTURE_STATUSES, "resting"),
    pasture_type: str(d.pasture_type),
    capacity_heads: capacity,
    water_status: parseStatusOrThrow(d.water_status, WATER_STATUSES, "unknown"),
    condition: parseStatusOrThrow(d.condition, PASTURE_CONDITIONS, "good"),
    soil_type: str(d.soil_type),
    notes: str(d.notes),
  };
}

/** Allow only real enum values; unknown values are REJECTED (the UI may offer
 *  a default, but a stray/corrupt value must never silently pass through). */
function parseStatusOrThrow<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (v === undefined || v === null || v === "") return fallback;
  const hit = oneOf(v, allowed);
  if (!hit) throw new Error(`"${String(v)}" is not a valid option here.`);
  return hit;
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
      return await savePastureCore(sql(), auth.operationId, data);
    } catch (err) {
      console.error("savePasture failed:", err);
      return { ok: false, error: "We couldn't save that pasture right now. Please try again." };
    }
  });

/** Injectable pasture insert/update — the exact SQL savePasture runs. */
export async function savePastureCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  p: PastureInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (p.id) {
    const updated = await db`
      UPDATE pastures SET name=${p.name}, size_acres=${p.size_acres}, location=${p.location},
        status=${p.status}, pasture_type=${p.pasture_type}, capacity_heads=${p.capacity_heads},
        water_status=${p.water_status}, condition=${p.condition}, soil_type=${p.soil_type},
        notes=${p.notes}, updated_at=now()
      WHERE id=${p.id} AND operation_id=${operationId} RETURNING id`;
    if (updated.length === 0) return { ok: false, error: `Pasture #${p.id} no longer exists in this ranch.` };
    return { ok: true, id: p.id };
  }
  const [row] = await db<[{ id: number }]>`
    INSERT INTO pastures (operation_id, name, size_acres, location, status, pasture_type,
                          capacity_heads, water_status, condition, soil_type, notes)
    VALUES (${operationId}, ${p.name}, ${p.size_acres}, ${p.location}, ${p.status}, ${p.pasture_type},
            ${p.capacity_heads}, ${p.water_status}, ${p.condition}, ${p.soil_type}, ${p.notes})
    RETURNING id`;
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// Write: pasture activity — record work on a paddock; when the operator asks
// (record_expense, default true) AND cost > 0, ALSO create ONE linked
// land/pasture expense (unique index backs exactly-once). One transaction.
// ---------------------------------------------------------------------------

export type PastureActivityInput = {
  pasture_id: number;
  activity_date: string;
  activity_type: ActivityType;
  cost_cents: number | null;
  notes: string | null;
  record_expense: boolean;
};

export function parsePastureActivityInput(raw: unknown): PastureActivityInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const pasture_id = optionalInt(d.pasture_id);
  if (!pasture_id || pasture_id <= 0) throw new Error("Pick the pasture this activity is for.");
  const activity_date = isoDate(d.activity_date);
  if (!activity_date) throw new Error("Activity date is required.");
  const activity_type = oneOf(d.activity_type, ACTIVITY_TYPES);
  if (!activity_type) throw new Error("Pick an activity type.");
  let cost_cents = optionalInt(d.cost_cents);
  if (cost_cents !== null && cost_cents < 0) throw new Error("Cost can't be negative.");
  if (d.cost_cents === "" || d.cost_cents === null || d.cost_cents === undefined || Number(d.cost_cents) === 0) {
    cost_cents = null;
  }
  return {
    pasture_id,
    activity_date,
    activity_type,
    cost_cents,
    notes: str(d.notes),
    record_expense: d.record_expense !== false,
  };
}

export const savePastureActivity = createServerFn({ method: "POST" })
  .validator(parsePastureActivityInput)
  .handler(async ({ data }): Promise<
    { ok: true; id: number; expense_created: boolean } | { ok: false; error: string }
  > => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      return await savePastureActivityCore(sql(), auth.operationId, data);
    } catch (err) {
      console.error("savePastureActivity failed:", err);
      return { ok: false, error: "We couldn't record that activity right now. Please try again." };
    }
  });

/** Injectable pasture-activity core — the exact transaction the handler runs.
 *  The pasture is validated scoped to the operation; the linked expense is
 *  created only when record_expense AND cost > 0. */
export async function savePastureActivityCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  a: PastureActivityInput
): Promise<{ ok: true; id: number; expense_created: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    const [pasture] = await tx<[{ name: string }]>`
      SELECT name FROM pastures WHERE id=${a.pasture_id} AND operation_id=${operationId} FOR UPDATE`;
    if (!pasture) return { ok: false, error: "That pasture no longer exists in this ranch." };
    const [row] = await tx<[{ id: number }]>`
      INSERT INTO pasture_activities (operation_id, pasture_id, activity_date, activity_type, cost_cents, notes)
      VALUES (${operationId}, ${a.pasture_id}, ${a.activity_date}, ${a.activity_type}, ${a.cost_cents}, ${a.notes})
      RETURNING id`;
    const wantsExpense = a.record_expense && a.cost_cents !== null && a.cost_cents > 0;
    if (wantsExpense) {
      await insertLinkedExpense(tx, operationId, {
        category: "land_pasture",
        expense_date: a.activity_date,
        amount_cents: a.cost_cents as number,
        vendor: null,
        notes: `Pasture activity — ${a.activity_type}${a.notes ? `: ${a.notes}` : ""}`,
        source_type: "pasture_activity",
        source_id: row.id,
        pasture_id: a.pasture_id,
      });
    }
    return { ok: true, id: row.id, expense_created: wantsExpense };
  });
}

// ---------------------------------------------------------------------------
// Write: move livestock (group-based) — close the active assignment, open the
// new one, and write a movement-history row. One transaction. No self-moves,
// no cross-operation ids, no negative head counts.
// ---------------------------------------------------------------------------

export type MoveLivestockInput = {
  herd_group_id: number;
  to_pasture_id: number;
  move_date: string;
  head_count: number | null;
  notes: string | null;
};

export function parseMoveLivestockInput(raw: unknown): MoveLivestockInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const herd_group_id = optionalInt(d.herd_group_id);
  if (!herd_group_id || herd_group_id <= 0) throw new Error("Pick the herd/group to move.");
  const to_pasture_id = optionalInt(d.to_pasture_id);
  if (!to_pasture_id || to_pasture_id <= 0) throw new Error("Pick the destination pasture.");
  const head_count = optionalInt(d.head_count);
  if (head_count !== null && head_count < 0) throw new Error("Head count can't be negative.");
  const move_date = isoDate(d.move_date);
  if (!move_date) throw new Error("Move date is required.");
  return { herd_group_id, to_pasture_id, move_date, head_count, notes: str(d.notes) };
}

export const moveLivestock = createServerFn({ method: "POST" })
  .validator(parseMoveLivestockInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      return await moveLivestockCore(sql(), auth.operationId, data);
    } catch (err) {
      console.error("moveLivestock failed:", err);
      return { ok: false, error: "We couldn't move that group right now. Please try again." };
    }
  });

/** Injectable move core — the exact transaction moveLivestock runs. */
export async function moveLivestockCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  m: MoveLivestockInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    // Cross-operation rejection: both ids must exist inside THIS operation.
    const [pasture] = await tx<[{ id: number }]>`
      SELECT id FROM pastures WHERE id=${m.to_pasture_id} AND operation_id=${operationId} FOR UPDATE`;
    if (!pasture) return { ok: false, error: "That destination pasture no longer exists in this ranch." };
    const [group] = await tx<[{ id: number }]>`
      SELECT id FROM herd_groups WHERE id=${m.herd_group_id} AND operation_id=${operationId} FOR UPDATE`;
    if (!group) return { ok: false, error: "That herd/group no longer exists in this ranch." };

    const active = await tx<[{ assignment_id: number; pasture_id: number | null }]>`
      SELECT pa.id AS assignment_id, pa.pasture_id FROM pasture_assignments pa
      WHERE pa.herd_group_id=${m.herd_group_id} AND pa.ended_at IS NULL AND pa.operation_id=${operationId}
      ORDER BY pa.assigned_at DESC, pa.id DESC LIMIT 1`;

    // No self-move: a group already in the destination pasture stays put.
    if (active.length > 0 && active[0].pasture_id === m.to_pasture_id) {
      return { ok: false, error: `That group is already in this pasture — no move needed.` };
    }
    const fromPastureId = active.length > 0 ? active[0].pasture_id : null;

    if (active.length > 0) {
      await tx`
        UPDATE pasture_assignments SET ended_at=${m.move_date}
        WHERE id=${active[0].assignment_id} AND operation_id=${operationId}`;
    }
    await tx`
      INSERT INTO pasture_assignments (operation_id, pasture_id, herd_group_id, assigned_at, notes)
      VALUES (${operationId}, ${m.to_pasture_id}, ${m.herd_group_id}, ${m.move_date}, ${m.notes})
      RETURNING id`;
    const [move] = await tx<[{ id: number }]>`
      INSERT INTO livestock_movements (operation_id, from_pasture_id, to_pasture_id, move_date,
                                       herd_group_id, head_count, notes)
      VALUES (${operationId}, ${fromPastureId}, ${m.to_pasture_id}, ${m.move_date},
              ${m.herd_group_id}, ${m.head_count}, ${m.notes})
      RETURNING id`;
    return { ok: true, id: move.id };
  });
}