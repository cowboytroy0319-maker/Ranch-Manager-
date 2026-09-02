// ============================================================================
// Ranch Manager Pro — Equipment, Fuel & Maintenance server functions (the only
// place that talks to the database for this module). Import only from route
// files; the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import type { EquipmentData, EquipmentItem, FuelEntry, MaintenanceRecord } from "~/types/equipment";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getEquipmentData = createServerFn().handler(async (): Promise<EquipmentData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, equipment: [], maintenance: [], fuel: [] };
  }
  try {
    const db = sql();
    const [equipRows, maintRows, fuelRows] = await Promise.all([
      db`
        SELECT id, name, category, make, model, year,
               hours::float8 AS hours, miles::float8 AS miles, condition, status,
               location, license_plate, fuel_type, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM equipment
        ORDER BY category, name, id`,
      db`
        SELECT id, equipment_id, to_char(service_date, 'YYYY-MM-DD') AS service_date, service_type,
               description, cost_cents,
               meter_hours::float8 AS meter_hours, meter_miles::float8 AS meter_miles, status,
               to_char(next_due_date, 'YYYY-MM-DD') AS next_due_date,
               next_due_hours::float8 AS next_due_hours, next_due_miles::float8 AS next_due_miles,
               vendor
        FROM maintenance_records
        ORDER BY service_date DESC, id DESC`,
      db`
        SELECT f.id, f.equipment_id, e.name AS equipment_name,
               to_char(f.fuel_date, 'YYYY-MM-DD') AS fuel_date, f.fuel_type,
               f.gallons::float8 AS gallons, f.cost_cents,
               f.price_per_gal_cents, f.meter_hours::float8 AS meter_hours,
               f.meter_miles::float8 AS meter_miles, f.location, f.notes
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
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
