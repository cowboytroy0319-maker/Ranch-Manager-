// ============================================================================
// Ranch Manager Pro — Equipment, Fuel & Maintenance server functions (the only
// place that talks to the database for this module). Import only from route
// files; the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import { loadExpenseLinkColumns } from "~/expenseSchema";
// ONE shared linked-expense implementation (audit Phase 2) — the create/edit/
// void cores below use it so equipment behaves exactly like restock/pasture.
import { insertLinkedExpense, syncLinkedExpenseOnEdit, removeLinkedExpense } from "./expenseLink";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  FUEL_TYPES,
  MAINT_STATUSES,
  MAINT_TYPES,
  type EquipmentData,
  type EquipmentItem,
  type FuelEntry,
  type FuelType,
  type MaintenanceRecord,
  type MaintStatus,
  type MaintType,
} from "~/types/equipment";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getEquipmentData = createServerFn().handler(async (): Promise<EquipmentData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, equipment: [], maintenance: [], fuel: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    // Link-column discovery (the D2 defensive pattern, expenseSchema): on a
    // database without 0018 the join below is skipped entirely and every row
    // reads as unlinked instead of the page dying on an absent column.
    const linkCols = await loadExpenseLinkColumns(db);
    const linked = linkCols.sourceType && linkCols.sourceId;
    const maintExpenseJoin = linked
      ? db`LEFT JOIN expenses xm ON xm.source_type = 'maintenance' AND xm.source_id = m.id`
      : db``;
    const maintExpenseSelect = linked
      ? db`xm.id AS expense_id, xm.amount_cents AS expense_amount_cents, (xm.id IS NOT NULL) AS expense_linked`
      : db`NULL::int AS expense_id, NULL::int AS expense_amount_cents, false AS expense_linked`;
    const fuelExpenseJoin = linked
      ? db`LEFT JOIN expenses xf ON xf.source_type = 'fuel_log' AND xf.source_id = f.id`
      : db``;
    const fuelExpenseSelect = linked
      ? db`xf.id AS expense_id, xf.amount_cents AS expense_amount_cents, (xf.id IS NOT NULL) AS expense_linked`
      : db`NULL::int AS expense_id, NULL::int AS expense_amount_cents, false AS expense_linked`;
    const [equipRows, maintRows, fuelRows] = await Promise.all([
      db`
        SELECT id, name, category, make, model, year,
               hours::float8 AS hours, miles::float8 AS miles, condition, status,
               location, license_plate, fuel_type, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM equipment
        WHERE operation_id = ${auth.operationId}
        ORDER BY category, name, id`,
      db`
        SELECT m.id, m.equipment_id, to_char(m.service_date, 'YYYY-MM-DD') AS service_date, m.service_type,
               m.description, m.cost_cents,
               m.meter_hours::float8 AS meter_hours, m.meter_miles::float8 AS meter_miles, m.status,
               to_char(m.next_due_date, 'YYYY-MM-DD') AS next_due_date,
               m.next_due_hours::float8 AS next_due_hours, m.next_due_miles::float8 AS next_due_miles,
               m.vendor,
               ${maintExpenseSelect}
        FROM maintenance_records m
        ${maintExpenseJoin}
        WHERE m.operation_id = ${auth.operationId}
        ORDER BY m.service_date DESC, m.id DESC`,
      db`
        SELECT f.id, f.equipment_id, e.name AS equipment_name,
               to_char(f.fuel_date, 'YYYY-MM-DD') AS fuel_date, f.fuel_type,
               f.gallons::float8 AS gallons, f.cost_cents,
               f.price_per_gal_cents, f.meter_hours::float8 AS meter_hours,
               f.meter_miles::float8 AS meter_miles, f.location, f.notes,
               ${fuelExpenseSelect}
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
        ${fuelExpenseJoin}
        WHERE f.operation_id = ${auth.operationId}
        ORDER BY f.fuel_date DESC, f.id DESC
        LIMIT 300`,
    ]);

    return {
      configured: true,
      equipment: equipRows as unknown as EquipmentItem[],
      maintenance: maintRows as unknown as MaintenanceRecord[],
      fuel: fuelRows as unknown as FuelEntry[],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      equipment: [],
      maintenance: [],
      fuel: [],
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

/** Non-negative number (hours/miles) or null. Accepts decimals. */
const nonNegativeNum = (v: unknown, field: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`);
  if (n < 0) throw new Error(`${field} can't be negative.`);
  return n;
};

const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export type EquipmentInput = {
  id?: number;
  name: string;
  category: EquipmentItem["category"];
  make: string | null;
  model: string | null;
  year: number | null;
  hours: number | null;
  miles: number | null;
  location: string | null;
  fuel_type: string | null;
  notes: string | null;
  status: EquipmentItem["status"];
};

export function parseEquipmentInput(raw: unknown): EquipmentInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  if (!name) throw new Error("Equipment name is required.");
  if (name.length > 200) throw new Error("Equipment name is too long (max 200 characters).");
  const id = optionalInt(d.id);
  const year = optionalInt(d.year);
  if (year !== null && (year < 1900 || year > 2100)) {
    throw new Error("Year must be between 1900 and 2100.");
  }
  return {
    id: id === null ? undefined : id,
    name,
    category: oneOf(d.category, EQUIPMENT_CATEGORIES) ?? "other",
    make: str(d.make),
    model: str(d.model),
    year,
    hours: nonNegativeNum(d.hours, "Hours"),
    miles: nonNegativeNum(d.miles, "Miles"),
    location: str(d.location),
    fuel_type: oneOf(d.fuel_type, FUEL_TYPES as readonly string[]) ?? null,
    notes: str(d.notes),
    status: oneOf(d.status, EQUIPMENT_STATUSES) ?? "in-service",
  };
}

// ---------------------------------------------------------------------------
// Write: save equipment (insert or update)
// ---------------------------------------------------------------------------

export const saveEquipment = createServerFn({ method: "POST" })
  .validator(parseEquipmentInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      const db = sql();
      const e = data;
      if (e.id) {
        const updated = await db`
          UPDATE equipment SET name=${e.name}, category=${e.category}, make=${e.make}, model=${e.model},
            year=${e.year}, hours=${e.hours}, miles=${e.miles}, location=${e.location},
            fuel_type=${e.fuel_type}, notes=${e.notes}, status=${e.status}, updated_at=now()
          WHERE id=${e.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Unit #${e.id} no longer exists in this ranch.` };
        return { ok: true, id: e.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO equipment (operation_id, name, category, make, model, year, hours, miles,
                               location, fuel_type, notes, status)
        VALUES (${auth.operationId}, ${e.name}, ${e.category}, ${e.make}, ${e.model}, ${e.year}, ${e.hours}, ${e.miles},
                ${e.location}, ${e.fuel_type}, ${e.notes}, ${e.status})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
// ---------------------------------------------------------------------------
// Validation + Write: log a fuel fill (audit Phase 2 — D2 linked-fuel model,
// D3 idempotency). The fill-up and its ONE linked ledger row (category 'fuel',
// source_type 'fuel_log') are written inside ONE transaction: a failed expense
// rolls the fill-up back, and a retry with the same client_request_id applies
// nothing. NULL/0 cost → NO expense, ever (never a silent $0 ledger row).
// ---------------------------------------------------------------------------
const optInt = optionalInt;
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  return s;
};
const posNum = (v: unknown, field: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be greater than zero.`);
  return n;
};
/** The request id every equipment money-write carries (restock precedent,
 *  feed.ts parseRestockInput): required, ≤200 chars, per-operation — the same
 *  id may be reused by a different ranch without collision. */
const parseClientRequestId = (v: unknown): string => {
  const id = str(v);
  if (!id) throw new Error("A request id is required — try again.");
  if (id.length > 200) throw new Error("Request id is too long.");
  return id;
};

export type FuelLogInput = {
  client_request_id: string;
  create_expense: boolean;
  equipment_id: number | null;
  fuel_date: string;
  fuel_type: FuelType;
  gallons: number;
  cost_cents: number | null;
  location: string | null;
  notes: string | null;
};
export function parseFuelLogInput(raw: unknown): FuelLogInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const date = isoDate(d.fuel_date);
  if (!date) throw new Error("Fuel date is required (YYYY-MM-DD).");
  return {
    client_request_id: parseClientRequestId(d.client_request_id),
    create_expense: d.create_expense !== false,
    equipment_id: optInt(d.equipment_id),
    fuel_date: date,
    fuel_type: (oneOf(d.fuel_type, FUEL_TYPES as readonly string[]) ?? "diesel") as FuelType,
    gallons: posNum(d.gallons, "Gallons"),
    cost_cents: d.cost_cents === null || d.cost_cents === undefined || d.cost_cents === "" ? null : Math.max(0, Math.round(Number(d.cost_cents))),
    location: str(d.location),
    notes: str(d.notes),
  };
}

export type EquipmentMoneyWriteResult =
  | { ok: true; id: number; expense_created: boolean; duplicate: boolean }
  | { ok: false; error: string };

export const logFuel = createServerFn({ method: "POST" })
  .validator(parseFuelLogInput)
  .handler(async ({ data: f }): Promise<EquipmentMoneyWriteResult> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await logFuelCore(sql(), auth.operationId, f);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't log that fill-up right now. Please try again." };
    }
  });

/** Injectable fuel core — the exact transaction logFuel runs (audit Phase 2).
 *  ONE transaction: duplicate precheck → the operation-scoped INSERT…SELECT →
 *  the ONE linked ledger row when a cost is present and the linked-expense
 *  choice is on. A failed expense rolls the fill-up back (never a partial
 *  write), and the DB backstops are uq_fuel_log_operation_request on
 *  (operation_id, client_request_id) for the record plus
 *  expenses_source_once_uniq for exactly-once expenses. */
export async function logFuelCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  f: FuelLogInput
): Promise<EquipmentMoneyWriteResult> {
  return await db.begin(async (tx) => {
    // Idempotency first (restock precedent, feed.ts 463–473): the SAME
    // client_request_id for this operation returns the original row WITHOUT
    // re-applying anything — no second fill-up, no second expense.
    const prior = await tx<[{ id: number; cost_cents: number | null }]>`
      SELECT id, cost_cents FROM fuel_log
      WHERE client_request_id = ${f.client_request_id} AND operation_id = ${operationId}`;
    if (prior.length > 0) {
      return {
        ok: true,
        id: prior[0].id,
        expense_created: prior[0].cost_cents !== null && prior[0].cost_cents > 0,
        duplicate: true,
      };
    }
    // Scope through the equipment: the machine must belong to this operation,
    // or the INSERT ... SELECT affects 0 rows (cross-ranch mutation rejected).
    // A NULL equipment_id is allowed (bulk tank top-up).
    const [row] = await tx<[{ id: number }]>`
      INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents, location, notes, client_request_id)
      SELECT ${operationId}, CASE WHEN ${f.equipment_id}::int IS NULL THEN NULL ELSE ${f.equipment_id}::int END,
             ${f.fuel_date}, ${f.fuel_type}, ${f.gallons}, ${f.cost_cents}, ${f.location}, ${f.notes}, ${f.client_request_id}
      WHERE ${f.equipment_id}::int IS NULL
         OR EXISTS (SELECT 1 FROM equipment e WHERE e.id = ${f.equipment_id}::int AND e.operation_id = ${operationId})
      RETURNING id`;
    if (!row) return { ok: false, error: "That equipment doesn't exist in this ranch." };
    const wantsExpense = f.create_expense && f.cost_cents !== null && f.cost_cents > 0;
    if (wantsExpense) {
      // The ledger row carries exactly what the operator typed (Phase 3 polish,
      // verifier finding: fuel-linked expenses were created with an empty
      // vendor). For a fill-up the location IS the vendor of the purchase —
      // the station/tank where the fuel was bought — so it becomes vendor;
      // notes pass through verbatim. Nothing is invented when a field is
      // blank: a blank location stays a NULL vendor, a blank note stays a
      // NULL note (no fabricated vendor, no silently dropped context).
      await insertLinkedExpense(tx, operationId, {
        category: "fuel",
        expense_date: f.fuel_date,
        amount_cents: f.cost_cents as number,
        vendor: f.location,
        notes: f.notes,
        source_type: "fuel_log",
        source_id: row.id,
        equipment_id: f.equipment_id,
      });
    }
    return { ok: true, id: row.id, expense_created: wantsExpense, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Validation + Write: log a maintenance/service record (audit Phase 2 — D1:
// the repair cost finally reaches Expenses as ONE linked ledger row, category
// 'repairs_maintenance', source_type 'maintenance'; D3 idempotency). Same
// one-transaction shape as the fuel core above.
// ---------------------------------------------------------------------------
export type MaintLogInput = {
  client_request_id: string;
  create_expense: boolean;
  equipment_id: number;
  service_date: string;
  service_type: MaintType;
  description: string | null;
  cost_cents: number | null;
  meter_hours: number | null;
  meter_miles: number | null;
  status: MaintStatus;
  next_due_date: string | null;
  next_due_hours: number | null;
  next_due_miles: number | null;
  vendor: string | null;
};
export function parseMaintLogInput(raw: unknown): MaintLogInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const date = isoDate(d.service_date);
  if (!date) throw new Error("Service date is required (YYYY-MM-DD).");
  const eqId = optInt(d.equipment_id);
  if (eqId === null) throw new Error("Pick the equipment this service is for.");
  return {
    client_request_id: parseClientRequestId(d.client_request_id),
    create_expense: d.create_expense !== false,
    equipment_id: eqId,
    service_date: date,
    service_type: oneOf(d.service_type, MAINT_TYPES) ?? "other",
    description: str(d.description),
    cost_cents: d.cost_cents === null || d.cost_cents === undefined || d.cost_cents === "" ? null : Math.max(0, Math.round(Number(d.cost_cents))),
    meter_hours: nonNegativeNum(d.meter_hours, "Meter hours"),
    meter_miles: nonNegativeNum(d.meter_miles, "Meter miles"),
    status: oneOf(d.status, MAINT_STATUSES) ?? "done",
    next_due_date: isoDate(d.next_due_date),
    next_due_hours: nonNegativeNum(d.next_due_hours, "Next due hours"),
    next_due_miles: nonNegativeNum(d.next_due_miles, "Next due miles"),
    vendor: str(d.vendor),
  };
}
export const logMaintenance = createServerFn({ method: "POST" })
  .validator(parseMaintLogInput)
  .handler(async ({ data: m }): Promise<EquipmentMoneyWriteResult> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await logMaintenanceCore(sql(), auth.operationId, m);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't log that service right now. Please try again." };
    }
  });

/** Injectable maintenance core — the exact transaction logMaintenance runs.
 *  ONE transaction: duplicate precheck → the operation-scoped INSERT…SELECT
 *  FROM equipment (unchanged scoping contract) → the ONE linked ledger row
 *  when a cost is present and the linked-expense choice is on. NULL/0 cost →
 *  NO expense, ever (S7: never a silent $0 ledger row). */
export async function logMaintenanceCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  m: MaintLogInput
): Promise<EquipmentMoneyWriteResult> {
  return await db.begin(async (tx) => {
    // Idempotency first (restock precedent, feed.ts 463–473).
    const prior = await tx<[{ id: number; cost_cents: number | null }]>`
      SELECT id, cost_cents FROM maintenance_records
      WHERE client_request_id = ${m.client_request_id} AND operation_id = ${operationId}`;
    if (prior.length > 0) {
      return {
        ok: true,
        id: prior[0].id,
        expense_created: prior[0].cost_cents !== null && prior[0].cost_cents > 0,
        duplicate: true,
      };
    }
    const [row] = await tx<[{ id: number }]>`
      INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, description,
                                       cost_cents, meter_hours, meter_miles, status, next_due_date,
                                       next_due_hours, next_due_miles, vendor, client_request_id)
      SELECT ${operationId}, ${m.equipment_id}, ${m.service_date}, ${m.service_type}, ${m.description},
             ${m.cost_cents}, ${m.meter_hours}, ${m.meter_miles}, ${m.status}, ${m.next_due_date},
             ${m.next_due_hours}, ${m.next_due_miles}, ${m.vendor}, ${m.client_request_id}
      FROM equipment e
      WHERE e.id = ${m.equipment_id} AND e.operation_id = ${operationId}
      RETURNING id`;
    if (!row) return { ok: false, error: "That equipment doesn't exist in this ranch." };
    const wantsExpense = m.create_expense && m.cost_cents !== null && m.cost_cents > 0;
    if (wantsExpense) {
      await insertLinkedExpense(tx, operationId, {
        category: "repairs_maintenance",
        expense_date: m.service_date,
        amount_cents: m.cost_cents as number,
        vendor: m.vendor,
        notes: m.description ? `Equipment service — ${m.description}` : "Equipment service",
        source_type: "maintenance",
        source_id: row.id,
        equipment_id: m.equipment_id,
      });
    }
    return { ok: true, id: row.id, expense_created: wantsExpense, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Edit (audit Phase 2 — D3): fuel and maintenance records were WRITE-ONLY — a
// typo'd $1,850 repair was permanent. The edit is operation-scoped, one
// transaction, absolute-value-set (a retried edit lands in the same place),
// and the linked ledger row FOLLOWS the source record: a cost > 0 updates the
// SAME expenses row (or inserts one if a legacy record has none), a removed or
// zero cost deletes it. No inventory is involved, so there is no below-zero
// rule — but the whole edit still applies or nothing does.
// ---------------------------------------------------------------------------

export type FuelEditInput = {
  id: number;
  fuel_date: string;
  fuel_type: FuelType;
  gallons: number;
  cost_cents: number | null;
  location: string | null;
  notes: string | null;
  meter_hours: number | null;
  meter_miles: number | null;
};

/** The edit cost rule (restock precedent): negative refused; ""/null/0 →
 *  null = "no expense" — a $0 expense can never be created silently. */
const parseEditCostCents = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined || Number(v) === 0) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Cost must be a number.");
  if (n < 0) throw new Error("Cost can't be negative.");
  return Math.round(n);
};

export function parseFuelEditInput(raw: unknown): FuelEditInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id || id <= 0) throw new Error("Pick the fill-up to edit.");
  const fuel_date = isoDate(d.fuel_date);
  if (!fuel_date) throw new Error("Fuel date is required (YYYY-MM-DD).");
  const fuel_type = oneOf(d.fuel_type, FUEL_TYPES as readonly string[]);
  if (!fuel_type) throw new Error("Pick a fuel type.");
  return {
    id,
    fuel_date,
    fuel_type: fuel_type as FuelType,
    gallons: posNum(d.gallons, "Gallons"),
    cost_cents: parseEditCostCents(d.cost_cents),
    location: str(d.location),
    notes: str(d.notes),
    meter_hours: nonNegativeNum(d.meter_hours, "Meter hours"),
    meter_miles: nonNegativeNum(d.meter_miles, "Meter miles"),
  };
}

export const updateFuel = createServerFn({ method: "POST" })
  .validator(parseFuelEditInput)
  .handler(async ({ data: r }): Promise<{ ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await updateFuelCore(sql(), auth.operationId, r);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't update that fill-up right now. Please try again." };
    }
  });

/** Injectable fuel-edit core — one transaction: lock the row (operation-scoped,
 *  so another ranch's id is invisible here), update the editable fields, then
 *  let the linked expense follow the source. */
export async function updateFuelCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  r: FuelEditInput
): Promise<{ ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }> {
  // Link-column discovery happens ONCE per process, outside the transaction
  // (audit defect D2 pattern): on a database missing the 0018 link columns an
  // edit must not fail on a SELECT of a column that isn't there.
  const linkCols = await loadExpenseLinkColumns(db);
  return await db.begin(async (tx) => {
    const [row] = await tx<[{ equipment_id: number | null }]>`
      SELECT equipment_id FROM fuel_log WHERE id=${r.id} AND operation_id=${operationId} FOR UPDATE`;
    if (!row) return { ok: false, error: "That fill-up no longer exists in this ranch." };
    await tx`
      UPDATE fuel_log SET fuel_date=${r.fuel_date}, fuel_type=${r.fuel_type}, gallons=${r.gallons},
        cost_cents=${r.cost_cents}, location=${r.location}, notes=${r.notes},
        meter_hours=${r.meter_hours}, meter_miles=${r.meter_miles}
      WHERE id=${r.id} AND operation_id=${operationId}`;
    const expense_linked = await syncLinkedExpenseOnEdit(tx, operationId, {
      linkCols,
      sourceType: "fuel_log",
      sourceId: r.id,
      costCents: r.cost_cents,
      expense: {
        // Same mapping as logFuelCore (the edit must keep the ledger row
        // consistent with the record): location → vendor, notes verbatim,
        // blank stays NULL — nothing invented, nothing dropped.
        category: "fuel",
        expense_date: r.fuel_date,
        amount_cents: r.cost_cents as number,
        vendor: r.location,
        notes: r.notes,
        source_type: "fuel_log",
        source_id: r.id,
        equipment_id: row.equipment_id,
      },
      missingColumnsMessage: "We couldn't update that fill-up right now. Please try again.",
      logLabel: "updateFuel",
    });
    return { ok: true, id: r.id, expense_linked };
  });
}

export type MaintEditInput = {
  id: number;
  service_date: string;
  service_type: MaintType;
  description: string | null;
  cost_cents: number | null;
  vendor: string | null;
  meter_hours: number | null;
  meter_miles: number | null;
  next_due_date: string | null;
  next_due_hours: number | null;
  next_due_miles: number | null;
};

export function parseMaintEditInput(raw: unknown): MaintEditInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id || id <= 0) throw new Error("Pick the service record to edit.");
  const service_date = isoDate(d.service_date);
  if (!service_date) throw new Error("Service date is required (YYYY-MM-DD).");
  const service_type = oneOf(d.service_type, MAINT_TYPES);
  if (!service_type) throw new Error("Pick a service type.");
  return {
    id,
    service_date,
    service_type: service_type as MaintType,
    description: str(d.description),
    cost_cents: parseEditCostCents(d.cost_cents),
    vendor: str(d.vendor),
    meter_hours: nonNegativeNum(d.meter_hours, "Meter hours"),
    meter_miles: nonNegativeNum(d.meter_miles, "Meter miles"),
    next_due_date: isoDate(d.next_due_date),
    next_due_hours: nonNegativeNum(d.next_due_hours, "Next due hours"),
    next_due_miles: nonNegativeNum(d.next_due_miles, "Next due miles"),
  };
}

export const updateMaintenance = createServerFn({ method: "POST" })
  .validator(parseMaintEditInput)
  .handler(async ({ data: r }): Promise<{ ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await updateMaintenanceCore(sql(), auth.operationId, r);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't update that service record right now. Please try again." };
    }
  });

/** Injectable maintenance-edit core — one transaction, same expense-follows-
 *  source rule as the fuel edit. The record's equipment cannot be reassigned
 *  here, so the linked expense's equipment allocation always stays right. */
export async function updateMaintenanceCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  r: MaintEditInput
): Promise<{ ok: true; id: number; expense_linked: boolean } | { ok: false; error: string }> {
  const linkCols = await loadExpenseLinkColumns(db);
  return await db.begin(async (tx) => {
    const [row] = await tx<[{ equipment_id: number }]>`
      SELECT equipment_id FROM maintenance_records WHERE id=${r.id} AND operation_id=${operationId} FOR UPDATE`;
    if (!row) return { ok: false, error: "That service record no longer exists in this ranch." };
    await tx`
      UPDATE maintenance_records SET service_date=${r.service_date}, service_type=${r.service_type},
        description=${r.description}, cost_cents=${r.cost_cents}, vendor=${r.vendor},
        meter_hours=${r.meter_hours}, meter_miles=${r.meter_miles},
        next_due_date=${r.next_due_date}, next_due_hours=${r.next_due_hours}, next_due_miles=${r.next_due_miles}
      WHERE id=${r.id} AND operation_id=${operationId}`;
    const expense_linked = await syncLinkedExpenseOnEdit(tx, operationId, {
      linkCols,
      sourceType: "maintenance",
      sourceId: r.id,
      costCents: r.cost_cents,
      expense: {
        category: "repairs_maintenance",
        expense_date: r.service_date,
        amount_cents: r.cost_cents as number,
        vendor: r.vendor,
        notes: r.description ? `Equipment service — ${r.description}` : "Equipment service",
        source_type: "maintenance",
        source_id: r.id,
        equipment_id: row.equipment_id,
      },
      missingColumnsMessage: "We couldn't update that service record right now. Please try again.",
      logLabel: "updateMaintenance",
    });
    return { ok: true, id: r.id, expense_linked };
  });
}

// ---------------------------------------------------------------------------
// Void (audit Phase 2 — D3): the restock void precedent — explicit confirm in
// the UI, the linked expense and the record removed TOGETHER in one
// transaction, banner states both halves. No separate audit table: the
// reversal policy is the same one the owner already runs for restock and
// pasture activities (noted in the PR for owner review).
// ---------------------------------------------------------------------------

export const deleteFuel = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const id = Number((raw ?? null) as unknown);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the fill-up to void.");
    return id;
  })
  .handler(async ({ data: id }): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await deleteFuelCore(sql(), auth.operationId, id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't void that fill-up right now. Please try again." };
    }
  });

/** Injectable fuel-void core — one transaction: the linked expense (if any) is
 *  deleted first, then the record. Nothing partial survives either failure. */
export async function deleteFuelCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  id: number
): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> {
  const linkCols = await loadExpenseLinkColumns(db);
  return await db.begin(async (tx) => {
    const [row] = await tx<[{ id: number }]>`
      SELECT id FROM fuel_log WHERE id=${id} AND operation_id=${operationId} FOR UPDATE`;
    if (!row) return { ok: false, error: "That fill-up no longer exists in this ranch." };
    const linked_expense_removed = await removeLinkedExpense(tx, operationId, {
      linkCols,
      sourceType: "fuel_log",
      sourceId: id,
    });
    await tx`DELETE FROM fuel_log WHERE id=${id} AND operation_id=${operationId}`;
    return { ok: true, linked_expense_removed };
  });
}

export const deleteMaintenance = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const id = Number((raw ?? null) as unknown);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the service record to void.");
    return id;
  })
  .handler(async ({ data: id }): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await deleteMaintenanceCore(sql(), auth.operationId, id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't void that service record right now. Please try again." };
    }
  });

/** Injectable maintenance-void core — one transaction: the linked expense (if
 *  any) is deleted first, then the record. */
export async function deleteMaintenanceCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  id: number
): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> {
  const linkCols = await loadExpenseLinkColumns(db);
  return await db.begin(async (tx) => {
    const [row] = await tx<[{ id: number }]>`
      SELECT id FROM maintenance_records WHERE id=${id} AND operation_id=${operationId} FOR UPDATE`;
    if (!row) return { ok: false, error: "That service record no longer exists in this ranch." };
    const linked_expense_removed = await removeLinkedExpense(tx, operationId, {
      linkCols,
      sourceType: "maintenance",
      sourceId: id,
    });
    await tx`DELETE FROM maintenance_records WHERE id=${id} AND operation_id=${operationId}`;
    return { ok: true, linked_expense_removed };
  });
}
