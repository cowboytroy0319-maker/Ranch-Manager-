// ============================================================================
// Ranch Manager Pro — Hay & Feed server functions (the only place that talks
// to the database for this module). Import only from route files/components;
// the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
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
    const db = sql();
    const [hayRows, feedRows, groupRows, usageRows] = await Promise.all([
      db`
        SELECT id, feed_type, cutting, field_or_source, storage_location,
               quantity::float8 AS quantity, unit, bale_weight_lbs::float8 AS bale_weight_lbs,
               to_char(date_acquired, 'YYYY-MM-DD') AS date_acquired,
               low_stock_threshold::float8 AS low_stock_threshold, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM hay_inventory
        ORDER BY feed_type, cutting NULLS LAST, id`,
      db`
        SELECT id, name, category, quantity::float8 AS quantity, unit, supplier,
               unit_cost_cents, low_stock_threshold::float8 AS low_stock_threshold, notes,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM feed_inventory
        ORDER BY category, name, id`,
      db`SELECT id, name, species, notes FROM herd_groups ORDER BY name`,
      db`
        SELECT u.id, to_char(u.log_date, 'YYYY-MM-DD') AS log_date, u.item_kind,
               u.hay_item_id, u.feed_item_id, u.quantity::float8 AS quantity, u.unit,
               u.herd_group_id, g.name AS herd_group_name, u.pasture, u.notes,
               u.created_at::text AS created_at
        FROM usage_log u
        LEFT JOIN herd_groups g ON g.id = u.herd_group_id
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
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const h = data;
      if (h.id) {
        const updated = await db`
          UPDATE hay_inventory SET feed_type=${h.feed_type}, cutting=${h.cutting},
            field_or_source=${h.field_or_source}, storage_location=${h.storage_location},
            quantity=${h.quantity}, unit=${h.unit}, bale_weight_lbs=${h.bale_weight_lbs},
            date_acquired=${h.date_acquired}, low_stock_threshold=${h.low_stock_threshold},
            notes=${h.notes}, updated_at=now()
          WHERE id=${h.id} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Hay stack #${h.id} no longer exists.` };
        return { ok: true, id: h.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO hay_inventory (feed_type, cutting, field_or_source, storage_location, quantity, unit,
                                   bale_weight_lbs, date_acquired, low_stock_threshold, notes)
        VALUES (${h.feed_type}, ${h.cutting}, ${h.field_or_source}, ${h.storage_location}, ${h.quantity},
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
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const f = data;
      if (f.id) {
        const updated = await db`
          UPDATE feed_inventory SET name=${f.name}, category=${f.category}, quantity=${f.quantity},
            unit=${f.unit}, supplier=${f.supplier}, unit_cost_cents=${f.unit_cost_cents},
            low_stock_threshold=${f.low_stock_threshold}, notes=${f.notes}, updated_at=now()
          WHERE id=${f.id} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Feed item #${f.id} no longer exists.` };
        return { ok: true, id: f.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO feed_inventory (name, category, quantity, unit, supplier, unit_cost_cents, low_stock_threshold, notes)
        VALUES (${f.name}, ${f.category}, ${f.quantity}, ${f.unit}, ${f.supplier}, ${f.unit_cost_cents},
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
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const u = data;
      if (u.quantity <= 0) return { ok: false, error: "Quantity used must be greater than zero." };
      if (!u.log_date) return { ok: false, error: "Date is required." };
      // Two explicit branches instead of dynamic table/column identifiers —
      // interpolated strings are parameters in postgres.js, not identifiers.
      return await db.begin(async (tx): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
        if (u.item_kind === "hay") {
          const [item] = await tx<[{ quantity: string; unit: string }]>`
            SELECT quantity, unit FROM hay_inventory WHERE id=${u.item_id} FOR UPDATE`;
          if (!item) return { ok: false, error: "That hay stack no longer exists." };
          const onHand = Number(item.quantity);
          if (onHand < u.quantity) {
            return { ok: false, error: `Only ${onHand} ${item.unit} on hand — can't use ${u.quantity} ${item.unit}.` };
          }
          const [row] = await tx<[{ id: number }]>`
            INSERT INTO usage_log (log_date, item_kind, hay_item_id, quantity, unit, herd_group_id, pasture, notes)
            VALUES (${u.log_date}, 'hay', ${u.item_id}, ${u.quantity}, ${item.unit}, ${u.herd_group_id}, ${u.pasture}, ${u.notes})
            RETURNING id`;
          await tx`UPDATE hay_inventory SET quantity = quantity - ${u.quantity}, updated_at = now() WHERE id=${u.item_id}`;
          return { ok: true, id: row.id };
        }
        const [item] = await tx<[{ quantity: string; unit: string }]>`
          SELECT quantity, unit FROM feed_inventory WHERE id=${u.item_id} FOR UPDATE`;
        if (!item) return { ok: false, error: "That feed item no longer exists." };
        const onHand = Number(item.quantity);
        if (onHand < u.quantity) {
          return { ok: false, error: `Only ${onHand} ${item.unit} on hand — can't use ${u.quantity} ${item.unit}.` };
        }
        const [row] = await tx<[{ id: number }]>`
          INSERT INTO usage_log (log_date, item_kind, feed_item_id, quantity, unit, herd_group_id, pasture, notes)
          VALUES (${u.log_date}, 'feed', ${u.item_id}, ${u.quantity}, ${item.unit}, ${u.herd_group_id}, ${u.pasture}, ${u.notes})
          RETURNING id`;
        await tx`UPDATE feed_inventory SET quantity = quantity - ${u.quantity}, updated_at = now() WHERE id=${u.item_id}`;
        return { ok: true, id: row.id };
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
