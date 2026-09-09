// ============================================================================
// Ranch Manager Pro — Hay & Feed server functions (the only place that talks
// to the database for this module). Import only from route files/components;
// the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import type { HerdGroupRef } from "~/types/feed";
import {
  FEED_CATEGORIES,
  FEED_UNITS,
  HAY_TYPES,
  HAY_UNITS,
  type FeedData,
  type FeedItem,
  type HayItem,
  type UsageEntry,
} from "~/types/feed";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

export const getFeedData = createServerFn().handler(async (): Promise<FeedData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, hay: [], feed: [], groups: [], usage: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const [hayRows, feedRows, groupRows, usageRows] = await Promise.all([
      db`
        SELECT id, feed_type, cutting, field_or_source, storage_location,
               quantity::float8 AS quantity, unit, bale_weight_lbs::float8 AS bale_weight_lbs,
               to_char(date_acquired, 'YYYY-MM-DD') AS date_acquired,
               low_stock_threshold::float8 AS low_stock_threshold, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM hay_inventory
        WHERE operation_id = ${auth.operationId}
        ORDER BY feed_type, cutting NULLS LAST, id`,
      db`
        SELECT id, name, category, quantity::float8 AS quantity, unit, supplier,
               unit_cost_cents, low_stock_threshold::float8 AS low_stock_threshold, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM feed_inventory
        WHERE operation_id = ${auth.operationId}
        ORDER BY category, name, id`,
      db`
        SELECT id, name, species, notes FROM herd_groups
        WHERE operation_id = ${auth.operationId}
        ORDER BY name`,
      db`
        SELECT u.id, to_char(u.log_date, 'YYYY-MM-DD') AS log_date, u.item_kind,
               u.hay_item_id, u.feed_item_id, u.quantity::float8 AS quantity, u.unit,
               u.herd_group_id, g.name AS herd_group_name, u.pasture, u.notes,
               u.created_at::text AS created_at
        FROM usage_log u
        LEFT JOIN herd_groups g ON g.id = u.herd_group_id
        WHERE u.operation_id = ${auth.operationId}
        ORDER BY u.log_date DESC, u.id DESC
        LIMIT 120`,
    ]);

    return {
      configured: true,
      hay: hayRows as unknown as HayItem[],
      feed: feedRows as unknown as FeedItem[],
      groups: groupRows as unknown as HerdGroupRef[],
      usage: usageRows as unknown as UsageEntry[],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      hay: [],
      feed: [],
      groups: [],
      usage: [],
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

const num = (v: unknown, field: string, { min = 0, required = true } = {}): number => {
  if (v === null || v === undefined || v === "") {
    if (required) throw new Error(`${field} is required.`);
    return min;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`);
  if (n < min) throw new Error(`${field} can't be below ${min}.`);
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

export type HayInput = {
  id?: number;
  feed_type: string;
  cutting: string | null;
  field_or_source: string | null;
  storage_location: string | null;
  quantity: number;
  unit: string;
  bale_weight_lbs: number | null;
  date_acquired: string | null;
  low_stock_threshold: number;
  notes: string | null;
};

export type FeedItemInput = {
  id?: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  supplier: string | null;
  unit_cost_cents: number | null;
  low_stock_threshold: number;
  notes: string | null;
};

export type UsageInput = {
  item_kind: string;
  item_id: number;
  log_date: string;
  quantity: number;
  herd_group_id: number | null;
  pasture: string | null;
  notes: string | null;
};

function parseHayInput(raw: unknown): HayInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const feed_type = oneOf(d.feed_type, HAY_TYPES);
  const unit = oneOf(d.unit, HAY_UNITS);
  if (!feed_type) throw new Error("Pick a hay type (grass, alfalfa, mixed, or other).");
  if (!unit) throw new Error("Pick a unit (bales or tons).");
  const bale_weight_lbs = unit === "bales" ? num(d.bale_weight_lbs, "Bale weight", { min: 0, required: false }) || null : null;
  return {
    id: optionalInt(d.id) ?? undefined,
    feed_type,
    cutting: str(d.cutting),
    field_or_source: str(d.field_or_source),
    storage_location: str(d.storage_location),
    quantity: num(d.quantity, "Quantity on hand"),
    unit,
    bale_weight_lbs: bale_weight_lbs && bale_weight_lbs > 0 ? bale_weight_lbs : null,
    date_acquired: isoDate(d.date_acquired),
    low_stock_threshold: num(d.low_stock_threshold, "Low-stock threshold", { required: false }),
    notes: str(d.notes),
  };
}

function parseFeedItemInput(raw: unknown): FeedItemInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = str(d.name);
  const category = oneOf(d.category, FEED_CATEGORIES);
  const unit = oneOf(d.unit, FEED_UNITS);
  if (!name) throw new Error("Name is required.");
  if (!category) throw new Error("Pick a category.");
  if (!unit) throw new Error("Pick a unit (lbs, bags, or tons).");
  return {
    id: optionalInt(d.id) ?? undefined,
    name,
    category,
    quantity: num(d.quantity, "Quantity on hand"),
    unit,
    supplier: str(d.supplier),
    unit_cost_cents: optionalInt(d.unit_cost_cents),
    low_stock_threshold: num(d.low_stock_threshold, "Low-stock threshold", { required: false }),
    notes: str(d.notes),
  };
}

function parseUsageInput(raw: unknown): UsageInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const item_kind = oneOf(d.item_kind, ["hay", "feed"] as const);
  const item_id = optionalInt(d.item_id);
  const log_date = isoDate(d.log_date);
  if (!item_kind) throw new Error("Pick whether this is hay or feed.");
  if (!item_id) throw new Error("Pick an inventory item.");
  if (!log_date) throw new Error("Date is required.");
  return {
    item_kind,
    item_id,
    log_date,
    quantity: num(d.quantity, "Quantity used", { min: 0 }),
    herd_group_id: optionalInt(d.herd_group_id),
    pasture: str(d.pasture),
    notes: str(d.notes),
  };
}

// ---------------------------------------------------------------------------
// Write: save hay stack (insert or update)
// ---------------------------------------------------------------------------

export const saveHay = createServerFn({ method: "POST" })
  .validator(parseHayInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      const db = sql();
      const h = data;
      if (h.id) {
        const updated = await db`
          UPDATE hay_inventory SET feed_type=${h.feed_type}, cutting=${h.cutting},
            field_or_source=${h.field_or_source}, storage_location=${h.storage_location},
            quantity=${h.quantity}, unit=${h.unit}, bale_weight_lbs=${h.bale_weight_lbs},
            date_acquired=${h.date_acquired}, low_stock_threshold=${h.low_stock_threshold},
            notes=${h.notes}, updated_at=now()
          WHERE id=${h.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Hay stack #${h.id} no longer exists.` };
        return { ok: true, id: h.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO hay_inventory (operation_id, feed_type, cutting, field_or_source, storage_location, quantity, unit,
                                   bale_weight_lbs, date_acquired, low_stock_threshold, notes)
        VALUES (${auth.operationId}, ${h.feed_type}, ${h.cutting}, ${h.field_or_source}, ${h.storage_location}, ${h.quantity},
                ${h.unit}, ${h.bale_weight_lbs}, ${h.date_acquired}, ${h.low_stock_threshold}, ${h.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: save feed item (insert or update)
// ---------------------------------------------------------------------------

export const saveFeedItem = createServerFn({ method: "POST" })
  .validator(parseFeedItemInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      const db = sql();
      const f = data;
      if (f.id) {
        const updated = await db`
          UPDATE feed_inventory SET name=${f.name}, category=${f.category}, quantity=${f.quantity},
            unit=${f.unit}, supplier=${f.supplier}, unit_cost_cents=${f.unit_cost_cents},
            low_stock_threshold=${f.low_stock_threshold}, notes=${f.notes}, updated_at=now()
          WHERE id=${f.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Feed item #${f.id} no longer exists.` };
        return { ok: true, id: f.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO feed_inventory (operation_id, name, category, quantity, unit, supplier, unit_cost_cents, low_stock_threshold, notes)
        VALUES (${auth.operationId}, ${f.name}, ${f.category}, ${f.quantity}, ${f.unit}, ${f.supplier}, ${f.unit_cost_cents},
                ${f.low_stock_threshold}, ${f.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: log usage — inserts the log entry and decrements the item's on-hand
// quantity in one transaction (rejects using more than is on hand).
// ---------------------------------------------------------------------------

export const logUsage = createServerFn({ method: "POST" })
  .validator(parseUsageInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      const db = sql();
      const u = data;
      if (u.quantity <= 0) return { ok: false, error: "Quantity used must be greater than zero." };
      if (!u.log_date) return { ok: false, error: "Date is required." };
      // Two explicit branches instead of dynamic table/column identifiers —
      // interpolated strings are parameters in postgres.js, not identifiers.
      // Every read/update is scoped by the session operation_id so a usage log
      // can never touch another operation's inventory.
      return await db.begin(async (tx): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
        if (u.item_kind === "hay") {
          const [item] = await tx<[{ quantity: string; unit: string }]>`
            SELECT quantity, unit FROM hay_inventory WHERE id=${u.item_id} AND operation_id=${auth.operationId} FOR UPDATE`;
          if (!item) return { ok: false, error: "That hay stack no longer exists." };
          const onHand = Number(item.quantity);
          if (onHand < u.quantity) {
            return { ok: false, error: `Only ${onHand} ${item.unit} on hand — can't use ${u.quantity} ${item.unit}.` };
          }
          const [row] = await tx<[{ id: number }]>`
            INSERT INTO usage_log (operation_id, log_date, item_kind, hay_item_id, quantity, unit, herd_group_id, pasture, notes)
            VALUES (${auth.operationId}, ${u.log_date}, 'hay', ${u.item_id}, ${u.quantity}, ${item.unit}, ${u.herd_group_id}, ${u.pasture}, ${u.notes})
            RETURNING id`;
          await tx`UPDATE hay_inventory SET quantity = quantity - ${u.quantity}, updated_at = now() WHERE id=${u.item_id} AND operation_id=${auth.operationId}`;
          return { ok: true, id: row.id };
        }
        const [item] = await tx<[{ quantity: string; unit: string }]>`
          SELECT quantity, unit FROM feed_inventory WHERE id=${u.item_id} AND operation_id=${auth.operationId} FOR UPDATE`;
        if (!item) return { ok: false, error: "That feed item no longer exists." };
        const onHand = Number(item.quantity);
        if (onHand < u.quantity) {
          return { ok: false, error: `Only ${onHand} ${item.unit} on hand — can't use ${u.quantity} ${item.unit}.` };
        }
        const [row] = await tx<[{ id: number }]>`
          INSERT INTO usage_log (operation_id, log_date, item_kind, feed_item_id, quantity, unit, herd_group_id, pasture, notes)
          VALUES (${auth.operationId}, ${u.log_date}, 'feed', ${u.item_id}, ${u.quantity}, ${item.unit}, ${u.herd_group_id}, ${u.pasture}, ${u.notes})
          RETURNING id`;
        await tx`UPDATE feed_inventory SET quantity = quantity - ${u.quantity}, updated_at = now() WHERE id=${u.item_id} AND operation_id=${auth.operationId}`;
        return { ok: true, id: row.id };
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: hay/feed RESTOCK — adds inventory and (optionally) records ONE linked
// expense, all in one transaction. Idempotent via client_request_id so a
// double-tap / retry / refresh never adds the same stock twice or creates a
// duplicate expense (the unique index expenses_source_once_uniq is the DB
// backstop for exactly-once). Category for the linked expense is 'hay_feed';
// source_type is 'restock'; source_id is the restock_log row.
// ---------------------------------------------------------------------------

export type RestockInput = {
  client_request_id: string;
  item_kind: "hay" | "feed";
  item_id: number;
  quantity: number;
  unit: string;
  restock_date: string;
  total_cost_cents: number | null;
  vendor: string | null;
  notes: string | null;
};

export function parseRestockInput(raw: unknown): RestockInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const client_request_id = str(d.client_request_id);
  if (!client_request_id) throw new Error("A request id is required — try again.");
  if (client_request_id.length > 200) throw new Error("Request id is too long.");
  const item_kind = oneOf(d.item_kind, ["hay", "feed"] as const);
  if (!item_kind) throw new Error("Pick whether this restock is hay or feed.");
  const item_id = optionalInt(d.item_id);
  if (!item_id || item_id <= 0) throw new Error("Pick an inventory item to restock.");
  const restock_date = isoDate(d.restock_date);
  if (!restock_date) throw new Error("Restock date is required.");
  const quantity = num(d.quantity, "Quantity added", { min: 0 });
  if (quantity <= 0) throw new Error("Quantity added must be greater than zero.");
  let total_cost_cents = optionalInt(d.total_cost_cents);
  if (total_cost_cents !== null && total_cost_cents < 0) {
    throw new Error("Total cost can't be negative.");
  }
  // A blank/empty/"0" cost means "no expense" (inventory only).
  if (d.total_cost_cents === "" || d.total_cost_cents === null || d.total_cost_cents === undefined || Number(d.total_cost_cents) === 0) {
    total_cost_cents = null;
  }
  return {
    client_request_id,
    item_kind,
    item_id,
    quantity,
    unit: str(d.unit) ?? "",
    restock_date,
    total_cost_cents,
    vendor: str(d.vendor),
    notes: str(d.notes),
  };
}

export const restockItem = createServerFn({ method: "POST" })
  .validator(parseRestockInput)
  .handler(async ({ data: r }): Promise<
    { ok: true; id: number; expense_created: boolean; duplicate: boolean } | { ok: false; error: string }
  > => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await restockItemCore(sql(), auth.operationId, r);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't restock that item right now. Please try again." };
    }
  });

/** Injectable restock core — the exact transaction restockItem runs. */
export async function restockItemCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  r: RestockInput
): Promise<{ ok: true; id: number; expense_created: boolean; duplicate: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    // Idempotency: the SAME client_request_id for this operation returns the
    // original row WITHOUT re-applying inventory or creating another expense.
    const prior = await tx<[{ id: number; total_cost_cents: number | null }]>`
      SELECT id, total_cost_cents FROM restock_log
      WHERE client_request_id = ${r.client_request_id} AND operation_id = ${operationId}`;
    if (prior.length > 0) {
      return {
        ok: true,
        id: prior[0].id,
        expense_created: prior[0].total_cost_cents !== null && prior[0].total_cost_cents > 0,
        duplicate: true,
      };
    }
    // The unit is pinned to the item's own unit (restocking in bales can't
    // silently restock tons). FOR UPDATE keeps the lock like logUsage.
    if (r.item_kind === "hay") {
      const [item] = await tx<[{ unit: string }]>`
        SELECT unit FROM hay_inventory WHERE id=${r.item_id} AND operation_id=${operationId} FOR UPDATE`;
      if (!item) return { ok: false, error: "That hay stack no longer exists." };
      const [log] = await tx<[{ id: number }]>`
        INSERT INTO restock_log (operation_id, item_kind, hay_item_id, quantity, unit,
                                 restock_date, total_cost_cents, vendor, notes, client_request_id)
        VALUES (${operationId}, 'hay', ${r.item_id}, ${r.quantity}, ${item.unit},
                ${r.restock_date}, ${r.total_cost_cents}, ${r.vendor}, ${r.notes}, ${r.client_request_id})
        RETURNING id`;
      await tx`UPDATE hay_inventory SET quantity = quantity + ${r.quantity}, updated_at = now()
        WHERE id=${r.item_id} AND operation_id=${operationId}`;
      if (r.total_cost_cents !== null && r.total_cost_cents > 0) {
        await insertLinkedExpense(tx, operationId, {
          category: "hay_feed",
          expense_date: r.restock_date,
          amount_cents: r.total_cost_cents,
          vendor: r.vendor,
          notes: r.notes ? `Hay restock — ${r.notes}` : "Hay restock",
          source_type: "restock",
          source_id: log.id,
        });
      }
      return { ok: true, id: log.id, expense_created: r.total_cost_cents !== null && r.total_cost_cents > 0, duplicate: false };
    }
    const [item] = await tx<[{ unit: string }]>`
      SELECT unit FROM feed_inventory WHERE id=${r.item_id} AND operation_id=${operationId} FOR UPDATE`;
    if (!item) return { ok: false, error: "That feed item no longer exists." };
    const [log] = await tx<[{ id: number }]>`
      INSERT INTO restock_log (operation_id, item_kind, feed_item_id, quantity, unit,
                               restock_date, total_cost_cents, vendor, notes, client_request_id)
      VALUES (${operationId}, 'feed', ${r.item_id}, ${r.quantity}, ${item.unit},
              ${r.restock_date}, ${r.total_cost_cents}, ${r.vendor}, ${r.notes}, ${r.client_request_id})
      RETURNING id`;
    await tx`UPDATE feed_inventory SET quantity = quantity + ${r.quantity}, updated_at = now()
      WHERE id=${r.item_id} AND operation_id=${operationId}`;
    if (r.total_cost_cents !== null && r.total_cost_cents > 0) {
      await insertLinkedExpense(tx, operationId, {
        category: "hay_feed",
        expense_date: r.restock_date,
        amount_cents: r.total_cost_cents,
        vendor: r.vendor,
        notes: r.notes ? `Feed restock — ${r.notes}` : "Feed restock",
        source_type: "restock",
        source_id: log.id,
      });
    }
    return { ok: true, id: log.id, expense_created: r.total_cost_cents !== null && r.total_cost_cents > 0, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Write: edit a restock — recompute the inventory delta and upsert the linked
// expense so history (and the ledger) always tells one consistent story.
// ---------------------------------------------------------------------------

export type RestockEditInput = {
  id: number;
  quantity: number;
  unit: string;
  restock_date: string;
  total_cost_cents: number | null;
  vendor: string | null;
  notes: string | null;
};

export function parseRestockEditInput(raw: unknown): RestockEditInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id || id <= 0) throw new Error("Pick the restock to edit.");
  const restock_date = isoDate(d.restock_date);
  if (!restock_date) throw new Error("Restock date is required.");
  const quantity = num(d.quantity, "Quantity added", { min: 0 });
  if (quantity <= 0) throw new Error("Quantity added must be greater than zero.");
  let total_cost_cents = optionalInt(d.total_cost_cents);
  if (total_cost_cents !== null && total_cost_cents < 0) throw new Error("Total cost can't be negative.");
  if (d.total_cost_cents === "" || d.total_cost_cents === null || d.total_cost_cents === undefined || Number(d.total_cost_cents) === 0) {
    total_cost_cents = null;
  }
  return {
    id,
    quantity,
    unit: str(d.unit) ?? "",
    restock_date,
    total_cost_cents,
    vendor: str(d.vendor),
    notes: str(d.notes),
  };
}

/** Owner rule (PR #4 review): never silently clamp inventory to zero. When an
 *  edit or delete would push the on-hand count below zero, the whole correction
 *  is refused — some units have already been used, so the book value is right
 *  and the "correction" would be the error. */
export const INVENTORY_BELOW_ZERO_ERROR =
  "This correction would take the stock below zero — some units have already been used. Nothing was changed.";

export const updateRestock = createServerFn({ method: "POST" })
  .validator(parseRestockEditInput)
  .handler(async ({ data: r }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await updateRestockCore(sql(), auth.operationId, r);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't update that restock right now. Please try again." };
    }
  });

/** Injectable restock-edit core — recompute inventory delta + upsert expense
 *  in one transaction (operation-scoped on every row it touches). */
export async function updateRestockCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  r: RestockEditInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    const [log] = await tx<[{ item_kind: "hay" | "feed"; hay_item_id: number | null; feed_item_id: number | null; quantity: string; unit: string }]>`
      SELECT item_kind, hay_item_id, feed_item_id, quantity, unit FROM restock_log
      WHERE id=${r.id} AND operation_id=${operationId} FOR UPDATE`;
    if (!log) return { ok: false, error: "That restock no longer exists." };
    const itemId = log.item_kind === "hay" ? log.hay_item_id : log.feed_item_id;
    if (!itemId) return { ok: false, error: "That restock's inventory item was deleted, so it can't be edited." };
    const oldQty = Number(log.quantity);
    const delta = r.quantity - oldQty;

    // Inventory safety (owner rule): read the current level under a row lock and
    // decide BEFORE any write, so a blocked edit applies nothing at all — no
    // partial inventory, restock_log, or expense changes.
    let current: number;
    if (log.item_kind === "hay") {
      const [inv] = await tx<[{ quantity: string }]>`SELECT quantity FROM hay_inventory
        WHERE id=${itemId} AND operation_id=${operationId} FOR UPDATE`;
      if (!inv) return { ok: false, error: "That restock's inventory item was deleted, so it can't be edited." };
      current = Number(inv.quantity);
    } else {
      const [inv] = await tx<[{ quantity: string }]>`SELECT quantity FROM feed_inventory
        WHERE id=${itemId} AND operation_id=${operationId} FOR UPDATE`;
      if (!inv) return { ok: false, error: "That restock's inventory item was deleted, so it can't be edited." };
      current = Number(inv.quantity);
    }
    if (current + delta < 0) {
      return { ok: false, error: INVENTORY_BELOW_ZERO_ERROR };
    }

    await tx`
      UPDATE restock_log SET quantity=${r.quantity}, unit=${r.unit}, restock_date=${r.restock_date},
        total_cost_cents=${r.total_cost_cents}, vendor=${r.vendor}, notes=${r.notes}
      WHERE id=${r.id} AND operation_id=${operationId}`;

    // Exact arithmetic, no clamp — the pre-check above guarantees the new level stays >= 0.
    if (log.item_kind === "hay") {
      await tx`UPDATE hay_inventory SET quantity = quantity + ${delta}, updated_at = now()
        WHERE id=${itemId} AND operation_id=${operationId}`;
    } else {
      await tx`UPDATE feed_inventory SET quantity = quantity + ${delta}, updated_at = now()
        WHERE id=${itemId} AND operation_id=${operationId}`;
    }

    // Upsert the linked expense: cost now > 0 → INSERT or UPDATE the existing
    // linked row (the unique index keeps exactly one); cost blank/0 → DELETE.
    const linked = await tx<[{ id: number; amount_cents: number }]>`
      SELECT id, amount_cents FROM expenses
      WHERE source_type='restock' AND source_id=${r.id} AND operation_id=${operationId}`;
    if (r.total_cost_cents !== null && r.total_cost_cents > 0) {
      if (linked.length > 0) {
        await tx`
          UPDATE expenses SET expense_date=${r.restock_date}, amount_cents=${r.total_cost_cents},
            vendor=${r.vendor}, notes=${r.notes ? `${log.item_kind === "hay" ? "Hay" : "Feed"} restock — ${r.notes}` : `${log.item_kind === "hay" ? "Hay" : "Feed"} restock`}
          WHERE id=${linked[0].id} AND operation_id=${operationId}`;
      } else {
        await insertLinkedExpense(tx, operationId, {
          category: "hay_feed",
          expense_date: r.restock_date,
          amount_cents: r.total_cost_cents,
          vendor: r.vendor,
          notes: r.notes ? `${log.item_kind === "hay" ? "Hay" : "Feed"} restock — ${r.notes}` : `${log.item_kind === "hay" ? "Hay" : "Feed"} restock`,
          source_type: "restock",
          source_id: r.id,
        });
      }
    } else if (linked.length > 0) {
      await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    }
    return { ok: true, id: r.id };
  });
}

// ---------------------------------------------------------------------------
// Write: delete a restock — reverse the inventory, remove the linked expense,
// then delete the restock row. One transaction, operation-scoped.
// ---------------------------------------------------------------------------

export const deleteRestock = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const id = Number((raw ?? null) as unknown);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the restock to delete.");
    return id;
  })
  .handler(async ({ data: id }): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) {
      console.error("DATABASE_URL is not set — cannot run this operation (database not configured).");
      return { ok: false, error: "We couldn't complete that right now. Please try again." };
    }
    try {
      const auth = await requireAuth();
      return await deleteRestockCore(sql(), auth.operationId, id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "We couldn't delete that restock right now. Please try again." };
    }
  });

/** Injectable restock-delete core — the exact transaction deleteRestock runs. */
export async function deleteRestockCore(
  db: ReturnType<typeof sql>,
  operationId: number,
  id: number
): Promise<{ ok: true; linked_expense_removed: boolean } | { ok: false; error: string }> {
  return await db.begin(async (tx) => {
    const [log] = await tx<[{ item_kind: "hay" | "feed"; hay_item_id: number | null; feed_item_id: number | null; quantity: string }]>`
      SELECT item_kind, hay_item_id, feed_item_id, quantity FROM restock_log
      WHERE id=${id} AND operation_id=${operationId} FOR UPDATE`;
    if (!log) return { ok: false, error: "That restock no longer exists." };
    const itemId = log.item_kind === "hay" ? log.hay_item_id : log.feed_item_id;
    const linked = await tx<[{ id: number }]>`
      SELECT id FROM expenses WHERE source_type='restock' AND source_id=${id} AND operation_id=${operationId}`;
    // DESIGN NOTE — audited inventory adjustments (owner-requested, NOT built
    // here): blocking a reversal below zero means stock that was already fed out
    // can't be un-recorded by deleting a restock. A future inventory-adjustment
    // record would need: the adjustment date, a signed delta (units added or
    // removed), a required reason (e.g. shrink, miscount, spoilage), and the
    // operation scope — written as its own audited row (who/when/why, plus the
    // resulting level) so the ledger stays explainable. No table or UI exists
    // yet; until it does, corrections that would push stock below zero stay
    // blocked with a plain-language message instead of being clamped.
    if (itemId) {
      let missing = false;
      let current = 0;
      if (log.item_kind === "hay") {
        const [inv] = await tx<[{ quantity: string }]>`SELECT quantity FROM hay_inventory
          WHERE id=${itemId} AND operation_id=${operationId} FOR UPDATE`;
        if (!inv) missing = true;
        else current = Number(inv.quantity);
      } else {
        const [inv] = await tx<[{ quantity: string }]>`SELECT quantity FROM feed_inventory
          WHERE id=${itemId} AND operation_id=${operationId} FOR UPDATE`;
        if (!inv) missing = true;
        else current = Number(inv.quantity);
      }
      if (!missing) {
        // Owner rule: never silently clamp. Decide BEFORE any write, so a blocked
        // delete applies nothing — inventory, expense, and the log row all stay put.
        if (current - Number(log.quantity) < 0) {
          return { ok: false, error: INVENTORY_BELOW_ZERO_ERROR };
        }
        // Exact arithmetic, no clamp — the check above guarantees the new level stays >= 0.
        if (log.item_kind === "hay") {
          await tx`UPDATE hay_inventory SET quantity = quantity - ${Number(log.quantity)}, updated_at = now()
            WHERE id=${itemId} AND operation_id=${operationId}`;
        } else {
          await tx`UPDATE feed_inventory SET quantity = quantity - ${Number(log.quantity)}, updated_at = now()
            WHERE id=${itemId} AND operation_id=${operationId}`;
        }
      }
    }
    if (linked.length > 0) {
      await tx`DELETE FROM expenses WHERE id=${linked[0].id} AND operation_id=${operationId}`;
    }
    await tx`DELETE FROM restock_log WHERE id=${id} AND operation_id=${operationId}`;
    return { ok: true, linked_expense_removed: linked.length > 0 };
  });
}

// ---------------------------------------------------------------------------
// Shared linked-expense insert (used by restock + pasture activity cores).
// The unique index expenses_source_once_uniq backs exactly-once — a duplicate
// (source_type, source_id) would violate it, so one source can never fund two
// ledger rows. Errors are logged server-side; callers surface safe messages.
// ---------------------------------------------------------------------------

/** A Postgres client inside a transaction (db.begin provides tx). */
export type Tx = import("postgres").TransactionSql;

export async function insertLinkedExpense(
  tx: Tx,
  operationId: number,
  e: {
    category: "hay_feed" | "land_pasture";
    expense_date: string;
    amount_cents: number;
    vendor: string | null;
    notes: string;
    source_type: "restock" | "pasture_activity";
    source_id: number;
    pasture_id?: number | null;
  }
): Promise<void> {
  await tx`
    INSERT INTO expenses (operation_id, expense_date, category, amount_cents, vendor, notes,
                          pasture_id, source_type, source_id)
    VALUES (${operationId}, ${e.expense_date}, ${e.category}, ${e.amount_cents}, ${e.vendor}, ${e.notes},
            ${e.pasture_id ?? null}, ${e.source_type}, ${e.source_id})`;
}
