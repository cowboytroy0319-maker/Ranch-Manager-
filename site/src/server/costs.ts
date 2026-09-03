// ============================================================================
// Ranch Manager Pro — Costs server function (the only place that talks to the
// database for the costs dashboard). The real DB has no general expense table,
// so the only REAL monetary field is fuel_log (cost_cents / price_per_gal_cents).
// This returns the current-month fuel summary; the other cost categories
// (feed / vet / maintenance / insurance) are honestly surfaced as "not yet
// tracked" by the UI until the expenses module ships.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";

export type FuelByEquipment = {
  equipment_name: string;
  entries: number;
  cost_cents: number;
  gallons: number;
};

export type FuelSummary = {
  month: string; // YYYY-MM of the current month (DB clock)
  totalCents: number;
  totalEntries: number;
  gallons: number;
  byEquipment: FuelByEquipment[];
};

export type CostData = {
  configured: boolean; // false when DATABASE_URL is missing
  error?: string; // short human-readable reason when configured but broken
  month: string;
  fuel: FuelSummary | null; // null when DATABASE_URL absent or no fuel this month
};

export const getCostData = createServerFn().handler(async (): Promise<CostData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, month: "", fuel: null };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const operationId = auth.operationId;
    const monthRow = await db`select to_char(date_trunc('month', now()), 'YYYY-MM') as m`;
    const month = monthRow[0]?.m ?? new Date().toISOString().slice(0, 7);
    const [summary, byEquip] = await Promise.all([
      db`
        SELECT coalesce(SUM(cost_cents), 0)::int AS total_cents,
               COUNT(*)::int AS total_entries,
               coalesce(SUM(gallons), 0)::float8 AS gallons, coalesce(AVG(price_per_gal_cents),0)::int AS avg_ppg
        FROM fuel_log
        WHERE operation_id = ${operationId}
          AND fuel_date >= date_trunc('month', now())::date`,
      db`
        SELECT coalesce(e.name, 'Unassigned') AS equipment_name,
               COUNT(*)::int AS entries,
               coalesce(SUM(f.cost_cents), 0)::int AS cost_cents,
               coalesce(SUM(f.gallons), 0)::float8 AS gallons
        FROM fuel_log f
        LEFT JOIN equipment e ON e.id = f.equipment_id
        WHERE f.operation_id = ${operationId}
          AND f.fuel_date >= date_trunc('month', now())::date
        GROUP BY 1
        ORDER BY cost_cents DESC`,
    ]);
    const s = summary[0];
    const fuel: FuelSummary = {
      month,
      totalCents: s.total_cents,
      totalEntries: s.total_entries,
      gallons: s.gallons,
      byEquipment: byEquip as unknown as FuelByEquipment[],
    };
    return { configured: true, month, fuel: s.total_entries > 0 ? fuel : null };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      month: new Date().toISOString().slice(0, 7),
      fuel: null,
    };
  }
});
