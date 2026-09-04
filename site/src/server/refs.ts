// ============================================================================
// Ranch Manager Pro — Quick-reference lists for create flows (Quick Add,
// add-expense, log-fuel/maintenance). One round trip returns every pick-list
// an operator needs to tie a new record to the right herd, pasture, equipment,
// or animal — all scoped to the session operation.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";

export type QuickRefs = {
  configured: boolean;
  error?: string;
  animals: { id: number; name: string; tag_number: string | null }[];
  groups: { id: number; name: string; species: string }[];
  pastures: { id: number; name: string }[];
  equipment: { id: number; name: string }[];
};

export const getQuickAddRefs = createServerFn().handler(async (): Promise<QuickRefs> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, animals: [], groups: [], pastures: [], equipment: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const [animals, groups, pastures, equipment] = await Promise.all([
      db`
        SELECT id, name, tag_number FROM animals
        WHERE ranch_id = ${auth.operationId}
        ORDER BY COALESCE(NULLIF(tag_number, ''), name), id`,
      db`
        SELECT id, name, species FROM herd_groups
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT id, name FROM pastures
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT id, name FROM equipment
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
    ]);
    return {
      configured: true,
      animals: animals as unknown as QuickRefs["animals"],
      groups: groups as unknown as QuickRefs["groups"],
      pastures: pastures as unknown as QuickRefs["pastures"],
      equipment: equipment as unknown as QuickRefs["equipment"],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      animals: [],
      groups: [],
      pastures: [],
      equipment: [],
    };
  }
});