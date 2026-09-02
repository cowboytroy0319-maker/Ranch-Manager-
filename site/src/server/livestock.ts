// ============================================================================
// Ranch Manager Pro — Livestock server functions (the only place that talks
// to the database for this module). Import only from route files/components;
// the handlers run on the server and return JSON-safe data.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { isDatabaseConfigured, sql } from "~/db";
import {
  ANIMAL_STATUSES,
  HEALTH_EVENT_TYPES,
  SEXES,
  SPECIES,
  type Animal,
  type HealthEvent,
  type HerdGroup,
  type LivestockData,
} from "~/types/livestock";

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------

/**
 * Resolve the operation/ranch this deployment runs as. The app is
 * single-operation today (no auth layer), so the single `operations` row is
 * the implicit ranch scope. Returns null when the database is unreachable or
 * no operation row exists yet (migration 0013 always seeds one).
 */
export async function currentRanchId(db: ReturnType<typeof sql>): Promise<number | null> {
  const rows = await db<[{ id: number }]>`SELECT id FROM operations ORDER BY id LIMIT 1`;
  return rows.length ? rows[0].id : null;
}

export const getLivestockData = createServerFn().handler(async (): Promise<LivestockData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, animals: [], groups: [], events: [] };
  }
  try {
    const db = sql();
    const [animalRows, groupRows, eventRows] = await Promise.all([
      db`
        SELECT a.id, a.species, a.name, a.tag_number, a.ranch_id, a.sex, a.breed,
               to_char(a.birth_date, 'YYYY-MM-DD') AS birth_date,
               to_char(a.acquisition_date, 'YYYY-MM-DD') AS acquisition_date,
               a.status, a.herd_group_id, g.name AS herd_group_name,
               a.pasture, a.notes,
               a.created_at::text AS created_at, a.updated_at::text AS updated_at
        FROM animals a
        LEFT JOIN herd_groups g ON g.id = a.herd_group_id
        ORDER BY a.species, COALESCE(NULLIF(a.tag_number, ''), a.name), a.id`,
      db`SELECT id, name, species, notes FROM herd_groups ORDER BY name`,
      db`
        SELECT id, animal_id, to_char(event_date, 'YYYY-MM-DD') AS event_date, type, description,
               product, dosage, vet, withdrawal_days,
               to_char(next_due, 'YYYY-MM-DD') AS next_due
        FROM health_events
        ORDER BY event_date DESC, id DESC`,
    ]);

    return {
      configured: true,
      animals: animalRows as unknown as Animal[],
      groups: groupRows as unknown as HerdGroup[],
      events: eventRows as unknown as HealthEvent[],
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      animals: [],
      groups: [],
      events: [],
    };
  }
});

// ---------------------------------------------------------------------------
// Validation helpers (plain, no schema library)
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

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

export type AnimalInput = {
  id?: number;
  species: string;
  name: string;
  tag_number: string;
  sex: string | null;
  breed: string | null;
  birth_date: string | null;
  acquisition_date: string | null;
  status: string;
  herd_group_id: number | null;
  pasture: string | null;
  notes: string | null;
};

export type HealthEventInput = {
  animal_id: number;
  event_date: string;
  type: string;
  description: string | null;
  product: string | null;
  dosage: string | null;
  vet: string | null;
  withdrawal_days: number | null;
  next_due: string | null;
};

export function parseAnimalInput(raw: unknown): AnimalInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const species = oneOf(d.species, SPECIES);
  const tag_number = str(d.tag_number);
  if (!species) throw new Error("Pick a species (cattle, horse, goat, or sheep).");
  if (!tag_number) throw new Error("Tag/animal ID is required.");
  // Name is optional: when absent, the tag doubles as the display name so
  // lists/detail stay consistent with a single source of truth (the row).
  const name = str(d.name) ?? tag_number;
  const id = optionalInt(d.id);
  const herd_group_id = optionalInt(d.herd_group_id);
  return {
    id: id === null ? undefined : id,
    species,
    name,
    tag_number,
    sex: oneOf(d.sex, SEXES),
    breed: str(d.breed),
    birth_date: isoDate(d.birth_date),
    acquisition_date: isoDate(d.acquisition_date),
    status: oneOf(d.status, ANIMAL_STATUSES) ?? "active",
    herd_group_id,
    pasture: str(d.pasture),
    notes: str(d.notes),
  };
}

/**
 * Pure duplicate-tag check over rows already loaded from the database, scoped
 * to the ranch/operation: a tag only collides with a DIFFERENT animal that
 * carries the same tag IN THE SAME RANCH. Rows with a different ranch_id (or
 * no ranch_id) never collide, so two operations may use the same tag. The row
 * being edited is ignored via `currentRanchId`-matching ranch_id + same id.
 * Shared by saveAnimal and the unit tests.
 */
export type TagRow = { id: number; tag_number: string | null; ranch_id?: number | null };

export function findTagCollision(
  rows: TagRow[],
  tag: string,
  currentId?: number,
  ranchId?: number | null
): boolean {
  const t = tag.trim();
  if (!t) return false;
  return rows.some(
    (r) =>
      r.tag_number === t &&
      // The animal being edited keeps its own tag (edit path).
      r.id !== currentId &&
      // Same tag in the same ranch only. Rows that lack a ranch_id (pre-0013
      // fixtures) are treated as unknown-scope and skipped, keeping the pure
      // function conservative: it never blocks on an ambiguous row.
      r.ranch_id !== undefined &&
      r.ranch_id !== null &&
      r.ranch_id === ranchId
  );
}

function parseHealthEventInput(raw: unknown): HealthEventInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const animal_id = optionalInt(d.animal_id);
  const type = oneOf(d.type, HEALTH_EVENT_TYPES);
  const event_date = isoDate(d.event_date);
  if (!animal_id) throw new Error("Health events must be attached to an animal.");
  if (!type) throw new Error("Pick an event type.");
  if (!event_date) throw new Error("Event date is required.");
  return {
    animal_id,
    event_date,
    type,
    description: str(d.description),
    product: str(d.product),
    dosage: str(d.dosage),
    vet: str(d.vet),
    withdrawal_days: optionalInt(d.withdrawal_days),
    next_due: isoDate(d.next_due),
  };
}

// ---------------------------------------------------------------------------
// Write: save animal (insert or update)
// ---------------------------------------------------------------------------

export const saveAnimal = createServerFn({ method: "POST" })
  .validator(parseAnimalInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    const a = data;
    const tag = a.tag_number.trim();
    try {
      const db = sql();
      // This deployment is one operation: the ranch scope is the single
      // operation row (README / migration 0013). No auth layer exists — do
      // not invent one; ranch_id is simply resolved and enforced here.
      const ranchId = await currentRanchId(db);
      if (ranchId === null) return { ok: false, error: "No operation (ranch) is set up yet." };
      if (a.id) {
        // Reject if another animal in THIS ranch already owns this tag
        // (exclude the row being edited; never touch an animal's ranch_id).
        const dups = await db<{ id: number; tag_number: string | null; ranch_id: number | null }[]>`
          SELECT id, tag_number, ranch_id FROM animals WHERE tag_number = ${tag} AND ranch_id = ${ranchId}`;
        if (findTagCollision(dups, tag, a.id, ranchId)) {
          return { ok: false, error: `Tag '${tag}' already exists in this ranch — tags must be unique.` };
        }
        const updated = await db`
          UPDATE animals SET species=${a.species}, name=${a.name}, tag_number=${a.tag_number},
            sex=${a.sex}, breed=${a.breed}, birth_date=${a.birth_date},
            acquisition_date=${a.acquisition_date}, status=${a.status},
            herd_group_id=${a.herd_group_id}, pasture=${a.pasture}, notes=${a.notes}, updated_at=now()
          WHERE id=${a.id} AND ranch_id=${ranchId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Animal #${a.id} no longer exists in this ranch.` };
        return { ok: true, id: a.id };
      }
      // Insert path: same ranch-scoped check first (brand-new row — nothing
      // excluded). ranch_id is the current operation so new animals always
      // land in this ranch.
      const dups = await db<{ id: number; tag_number: string | null; ranch_id: number | null }[]>`
        SELECT id, tag_number, ranch_id FROM animals WHERE tag_number = ${tag} AND ranch_id = ${ranchId}`;
      if (findTagCollision(dups, tag, a.id, ranchId)) {
        return { ok: false, error: `Tag '${tag}' already exists in this ranch — tags must be unique.` };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO animals (species, name, tag_number, sex, breed, birth_date, acquisition_date, status, herd_group_id, pasture, notes, ranch_id)
        VALUES (${a.species}, ${a.name}, ${a.tag_number}, ${a.sex}, ${a.breed}, ${a.birth_date},
                ${a.acquisition_date}, ${a.status}, ${a.herd_group_id}, ${a.pasture}, ${a.notes}, ${ranchId})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Backstop for the DB unique index (race between check + insert).
      if (/animals_ranch_tag_uniq|duplicate/i.test(msg)) {
        return { ok: false, error: `Tag '${tag}' already exists in this ranch — tags must be unique.` };
      }
      return { ok: false, error: msg };
    }
  });

// ---------------------------------------------------------------------------
// Write: add a health event
// ---------------------------------------------------------------------------

export const addHealthEvent = createServerFn({ method: "POST" })
  .validator(parseHealthEventInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const db = sql();
      const e = data;
      const [row] = await db<[{ id: number }]>`
        INSERT INTO health_events (animal_id, event_date, type, description, product, dosage, vet, withdrawal_days, next_due)
        VALUES (${e.animal_id}, ${e.event_date}, ${e.type}, ${e.description}, ${e.product}, ${e.dosage},
                ${e.vet}, ${e.withdrawal_days}, ${e.next_due})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
