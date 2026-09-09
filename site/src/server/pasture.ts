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
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
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
// IDEMPOTENT (mirrors restockItem): the same client_request_id for the same
// operation returns the original row creating NOTHING — a retry, double-tap,
// or flaky-network re-send can never double-record work or money. The DB
// unique index on client_request_id is the backstop if two requests race.
// ---------------------------------------------------------------------------

/** The honest outcome for a duplicate create (same client_request_id): the
 *  activity — and its linked expense, if any — are unchanged. */
export const PASTURE_ACTIVITY_DUPLICATE_MESSAGE =
  "Already recorded — activity and expense unchanged.";

export type PastureActivityInput = {
  client_request_id: string;
  pasture_id: number;
  activity_date: string;
  activity_type: ActivityType;
  cost_cents: number | null;
  notes: string | null;
  record_expense: boolean;
};

export function parsePastureActivityInput(raw: unknown): PastureActivityInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const client_request_id = str(d.client_request_id);
  if (!client_request_id) throw new Error("A request id is required — try again.");
  if (client_request_id.length > 200) throw new Error("Request id is too long.");
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
    client_request_id,
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
    { ok: true; id: number; expense_created: boolean; duplicate: boolean } | { ok: false; error: string }
  > => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await savePastureActivityCore(sql(), auth.operationId, data);
    } catch (err) {
      console.error("savePastureActivity failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't record that activity right now. Please try again." };
    }
  });

/** Injectable pasture-activity core — the exact transaction the handler runs.
 *  Idempotent: the FIRST thing inside the transaction is the duplicate check
 *  (same client_request_id + operation) — a hit returns the original row and
 *  creates nothing. Otherwise the pasture is validated scoped to the operation,
 *  the activity is inserted, and the linked expense is created only when
 *  record_expense AND cost > 0. */
export async function savePastureActivityCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  a: PastureActivityInput
): Promise<{ ok: true; id: number; expense_created: boolean; duplicate: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    // Idempotency first: the SAME client_request_id for this operation returns
    // the original activity WITHOUT creating anything (no second row, no
    // second expense — the caller gets the plain already-recorded outcome).
    const prior = await tx<[{ id: number; cost_cents: number | null }]>`
      SELECT id, cost_cents FROM pasture_activities
      WHERE client_request_id = ${a.client_request_id} AND operation_id = ${operationId}`;
    if (prior.length > 0) {
      const linked = await tx<[{ id: number }]>`
        SELECT id FROM expenses
        WHERE source_type = 'pasture_activity' AND source_id = ${prior[0].id}
          AND operation_id = ${operationId}`;
      return { ok: true, id: prior[0].id, expense_created: linked.length > 0, duplicate: true };
    }
    const [pasture] = await tx<[{ name: string }]>`
      SELECT name FROM pastures WHERE id=${a.pasture_id} AND operation_id=${operationId} FOR UPDATE`;
    if (!pasture) return { ok: false, error: "That pasture no longer exists in this ranch." };
    const [row] = await tx<[{ id: number }]>`
      INSERT INTO pasture_activities (operation_id, pasture_id, activity_date, activity_type, cost_cents, notes, client_request_id)
      VALUES (${operationId}, ${a.pasture_id}, ${a.activity_date}, ${a.activity_type}, ${a.cost_cents}, ${a.notes}, ${a.client_request_id})
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
    return { ok: true, id: row.id, expense_created: wantsExpense, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Corrections (edit / delete) — operation-scoped, transactional, and safe to
// retry. The edit is absolute-value-set (running the same edit twice lands in
// the same place); the delete is safe on repeat. The linked expense
// (source_type 'pasture_activity') always follows the activity so the ledger
// and the work log tell ONE consistent story — never a partial state.
// ---------------------------------------------------------------------------

export type PastureActivityEditInput = {
  id: number;
  activity_date: string;
  activity_type: ActivityType;
  cost_cents: number | null;
  notes: string | null;
  record_expense: boolean;
};

export function parsePastureActivityEditInput(raw: unknown): PastureActivityEditInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id || id <= 0) throw new Error("Pick the activity to edit.");
  const activity_date = isoDate(d.activity_date);
  if (!activity_date) throw new Error("Activity date is required.");
  const activity_type = oneOf(d.activity_type, ACTIVITY_TYPES);
  if (!activity_type) throw new Error("Pick an activity type.");
  let cost_cents = optionalInt(d.cost_cents);
  if (cost_cents !== null && cost_cents < 0) throw new Error("Cost can't be negative.");
  // A blank/empty/"0" cost means "no expense" — same rule as create.
  if (d.cost_cents === "" || d.cost_cents === null || d.cost_cents === undefined || Number(d.cost_cents) === 0) {
    cost_cents = null;
  }
  return {
    id,
    activity_date,
    activity_type,
    cost_cents,
    notes: str(d.notes),
    record_expense: d.record_expense !== false,
  };
}

export const updatePastureActivity = createServerFn({ method: "POST" })
  .validator(parsePastureActivityEditInput)
  .handler(async ({ data }): Promise<
    { ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }
  > => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await updatePastureActivityCore(sql(), auth.operationId, data);
    } catch (err) {
      console.error("updatePastureActivity failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't update that activity right now. Please try again." };
    }
  });

/** Injectable edit core — one transaction: update the activity row, then
 *  upsert (cost > 0 AND record_expense) or remove (blank/0 cost, or the box
 *  unchecked) the linked expense. Values are absolute, so a retried edit is
 *  naturally idempotent; the unique index on (source_type, source_id) keeps
 *  exactly one linked expense. */
export async function updatePastureActivityCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  e: PastureActivityEditInput
): Promise<{ ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    // Scoped to THIS operation — another ranch's activity id is invisible here.
    const [activity] = await tx<[{ pasture_id: number }]>`
      SELECT pasture_id FROM pasture_activities
      WHERE id=${e.id} AND operation_id=${operationId} FOR UPDATE`;
    if (!activity) return { ok: false, error: "That activity no longer exists in this ranch." };

    // Same "blank/0 means no cost" rule as create: store NULL, never 0.
    const costCents = e.cost_cents === 0 ? null : e.cost_cents;

    await tx`
      UPDATE pasture_activities SET activity_date=${e.activity_date}, activity_type=${e.activity_type},
        cost_cents=${costCents}, notes=${e.notes}
      WHERE id=${e.id} AND operation_id=${operationId}`;

    const linked = await tx<[{ id: number }]>`
      SELECT id FROM expenses
      WHERE source_type='pasture_activity' AND source_id=${e.id} AND operation_id=${operationId}`;
    const wantsExpense = e.record_expense && costCents !== null && costCents > 0;
    if (wantsExpense) {
      if (linked.length > 0) {
        // Amount, date, pasture, and notes follow the edited activity. (A
        // pasture activity has no vendor field, so the linked expense keeps
        // vendor NULL — same as create.)
        await tx`
          UPDATE expenses SET expense_date=${e.activity_date}, amount_cents=${costCents as number},
            pasture_id=${activity.pasture_id}, vendor=null,
            notes=${`Pasture activity — ${e.activity_type}${e.notes ? `: ${e.notes}` : ""}`}
          WHERE id=${linked[0].id} AND operation_id=${operationId}`;
      } else {
        await insertLinkedExpense(tx, operationId, {
          category: "land_pasture",
          expense_date: e.activity_date,
          amount_cents: costCents as number,
          vendor: null,
          notes: `Pasture activity — ${e.activity_type}${e.notes ? `: ${e.notes}` : ""}`,
          source_type: "pasture_activity",
          source_id: e.id,
          pasture_id: activity.pasture_id,
        });
      }
    } else if (linked.length > 0) {
      await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    }
    return { ok: true, id: e.id, expense_linked: wantsExpense };
  });
}

export const deletePastureActivity = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const id = Number((raw ?? null) as unknown);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the activity to delete.");
    return id;
  })
  .handler(async ({ data: id }): Promise<
    { ok: true; alreadyDeleted: boolean; linked_expense_removed: boolean } | { ok: false; error: string }
  > => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await deletePastureActivityCore(sql(), auth.operationId, id);
    } catch (err) {
      console.error("deletePastureActivity failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't delete that activity right now. Please try again." };
    }
  });

/** Injectable delete core — removes the activity AND its linked expense in ONE
 *  transaction, scoped to this operation. Safe on repeat: a second call (or an
 *  id that was never this operation's) finds nothing under this operation and
 *  reports the plain already-removed outcome instead of a raw error. */
export async function deletePastureActivityCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  id: number
): Promise<{ ok: true; alreadyDeleted: boolean; linked_expense_removed: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    const [activity] = await tx<[{ id: number }]>`
      SELECT id FROM pasture_activities WHERE id=${id} AND operation_id=${operationId} FOR UPDATE`;
    if (!activity) return { ok: true, alreadyDeleted: true, linked_expense_removed: false };
    const linked = await tx<[{ id: number }]>`
      SELECT id FROM expenses
      WHERE source_type='pasture_activity' AND source_id=${id} AND operation_id=${operationId}`;
    if (linked.length > 0) {
      await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    }
    await tx`DELETE FROM pasture_activities WHERE id=${id} AND operation_id=${operationId}`;
    return { ok: true, alreadyDeleted: false, linked_expense_removed: linked.length > 0 };
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
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
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