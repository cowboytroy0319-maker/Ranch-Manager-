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

export const getLivestockData = createServerFn().handler(async (): Promise<LivestockData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, animals: [], groups: [], events: [] };
  }
  try {
    const db = sql();
    const [animalRows, groupRows, eventRows] = await Promise.all([
      db`
        SELECT a.id, a.species, a.name, a.tag_number, a.sex, a.breed,
               to_char(a.birth_date, 'YYYY-MM-DD') AS birth_date,
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
  tag_number: string | null;
  sex: string | null;
  breed: string | null;
  birth_date: string | null;
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

function parseAnimalInput(raw: unknown): AnimalInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const species = oneOf(d.species, SPECIES);
  const name = str(d.name);
  if (!species) throw new Error("Pick a species (cattle, horse, goat, or sheep).");
  if (!name) throw new Error("Name or tag is required.");
  const id = optionalInt(d.id);
  const herd_group_id = optionalInt(d.herd_group_id);
  return {
    id: id === null ? undefined : id,
    species,
    name,
    tag_number: str(d.tag_number),
    sex: oneOf(d.sex, SEXES),
    breed: str(d.breed),
    birth_date: isoDate(d.birth_date),
    status: oneOf(d.status, ANIMAL_STATUSES) ?? "active",
    herd_group_id,
    pasture: str(d.pasture),
    notes: str(d.notes),
  };
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
    try {
      const db = sql();
      const a = data;
      if (a.id) {
        const updated = await db`
          UPDATE animals SET species=${a.species}, name=${a.name}, tag_number=${a.tag_number},
            sex=${a.sex}, breed=${a.breed}, birth_date=${a.birth_date}, status=${a.status},
            herd_group_id=${a.herd_group_id}, pasture=${a.pasture}, notes=${a.notes}, updated_at=now()
          WHERE id=${a.id} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Animal #${a.id} no longer exists.` };
        return { ok: true, id: a.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO animals (species, name, tag_number, sex, breed, birth_date, status, herd_group_id, pasture, notes)
        VALUES (${a.species}, ${a.name}, ${a.tag_number}, ${a.sex}, ${a.breed}, ${a.birth_date},
                ${a.status}, ${a.herd_group_id}, ${a.pasture}, ${a.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
