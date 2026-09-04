// ============================================================================
// Ranch Manager Pro — Equipment, Fuel & Maintenance server functions (the only
// place that talks to the database for this module). Import only from route
// files; the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
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
        SELECT id, equipment_id, to_char(service_date, 'YYYY-MM-DD') AS service_date, service_type,
               description, cost_cents,
               meter_hours::float8 AS meter_hours, meter_miles::float8 AS meter_miles, status,
               to_char(next_due_date, 'YYYY-MM-DD') AS next_due_date,
               next_due_hours::float8 AS next_due_hours, next_due_miles::float8 AS next_due_miles,
               vendor
        FROM maintenance_records
        WHERE operation_id = ${auth.operationId}
        ORDER BY service_date DESC, id DESC`,
      db`
        SELECT f.id, f.equipment_id, e.name AS equipment_name,
               to_char(f.fuel_date, 'YYYY-MM-DD') AS fuel_date, f.fuel_type,
               f.gallons::float8 AS gallons, f.cost_cents,
               f.price_per_gal_cents, f.meter_hours::float8 AS meter_hours,
               f.meter_miles::float8 AS meter_miles, f.location, f.notes
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
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
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
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
// Validation + Write: log a fuel fill (insert only, operation-scoped)
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
export type FuelLogInput = {
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
    equipment_id: optInt(d.equipment_id),
    fuel_date: date,
    fuel_type: (oneOf(d.fuel_type, FUEL_TYPES as readonly string[]) ?? "diesel") as FuelType,
    gallons: posNum(d.gallons, "Gallons"),
    cost_cents: d.cost_cents === null || d.cost_cents === undefined || d.cost_cents === "" ? null : Math.max(0, Math.round(Number(d.cost_cents))),
    location: str(d.location),
    notes: str(d.notes),
  };
}
export const logFuel = createServerFn({ method: "POST" })
  .validator(parseFuelLogInput)
  .handler(async ({ data: f }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      // Scope through the equipment: the machine must belong to this operation,
      // or the INSERT ... SELECT affects 0 rows (cross-ranch mutation rejected).
      // A NULL equipment_id is allowed (bulk tank top-up).
      const [row] = await db<[{ id: number }]>`
        INSERT INTO fuel_log (operation_id, equipment_id, fuel_date, fuel_type, gallons, cost_cents, location, notes)
        SELECT ${auth.operationId}, CASE WHEN ${f.equipment_id}::int IS NULL THEN NULL ELSE ${f.equipment_id}::int END,
               ${f.fuel_date}, ${f.fuel_type}, ${f.gallons}, ${f.cost_cents}, ${f.location}, ${f.notes}
        WHERE ${f.equipment_id}::int IS NULL
           OR EXISTS (SELECT 1 FROM equipment e WHERE e.id = ${f.equipment_id}::int AND e.operation_id = ${auth.operationId})
        RETURNING id`;
      if (!row) return { ok: false, error: "That equipment doesn't exist in this ranch." };
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
// ---------------------------------------------------------------------------
// Validation + Write: log a maintenance/service record (insert only)
// ---------------------------------------------------------------------------
export type MaintLogInput = {
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
  .handler(async ({ data: m }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const [row] = await db<[{ id: number }]>`
        INSERT INTO maintenance_records (operation_id, equipment_id, service_date, service_type, description,
                                         cost_cents, meter_hours, meter_miles, status, next_due_date,
                                         next_due_hours, next_due_miles, vendor)
        SELECT ${auth.operationId}, ${m.equipment_id}, ${m.service_date}, ${m.service_type}, ${m.description},
               ${m.cost_cents}, ${m.meter_hours}, ${m.meter_miles}, ${m.status}, ${m.next_due_date},
               ${m.next_due_hours}, ${m.next_due_miles}, ${m.vendor}
        FROM equipment e
        WHERE e.id = ${m.equipment_id} AND e.operation_id = ${auth.operationId}
        RETURNING id`;
      if (!row) return { ok: false, error: "That equipment doesn't exist in this ranch." };
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
