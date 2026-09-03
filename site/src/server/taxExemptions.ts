// ============================================================================
// Ranch Manager Pro — Tax & ag-exemption registry server functions (the only
// place that talks to the database for this module). Import only from route
// files/components; handlers run on the server and return JSON-safe data.
//
// This is RECORD-KEEPING, clearly not tax advice. Status (expired / upcoming /
// ok / none) is derived at read time from `expires_on` relative to "today";
// `expires_on = NULL` means the identifier never expires (e.g. an EIN).
// identifier_number is stored as text (an identifier, not money), and
// jurisdiction is free text (state/province/jurisdiction) so any region — not
// just US states — is supported.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import { UPCOMING_HORIZON_DAYS, type TaxExemptionData, type TaxExemptionInput, type TaxExemptionRow, type TaxExemptionStatus } from "~/types/taxExemptions";

// ---------------------------------------------------------------------------
// Small validators (same conventions as the employees/feed modules)
// ---------------------------------------------------------------------------
const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};
const req = (v: unknown, field: string): string => {
  const s = str(v);
  if (!s) throw new Error(`${field} is required.`);
  return s;
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

/** Local YYYY-MM-DD for "today" (avoids UTC/offset surprises for expiry math). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Derive expired/upcoming/ok/none from expires_on (string compare is safe for
 * zero-padded YYYY-MM-DD). NULL expires_on = "none" (never expires). */
function computeStatus(expiresOn: string | null, today: string): TaxExemptionStatus {
  if (!expiresOn) return "none";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, UPCOMING_HORIZON_DAYS)) return "upcoming";
  return "ok";
}

function parseInput(raw: unknown): TaxExemptionInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id: optionalInt(d.id) ?? undefined,
    identifier_type: req(d.identifier_type, "Identifier type"),
    identifier_number: str(d.identifier_number),
    jurisdiction: req(d.jurisdiction, "Jurisdiction (state/province)"),
    entity: str(d.entity),
    expires_on: isoDate(d.expires_on),
    contact: str(d.contact),
    notes: str(d.notes),
  };
}

// ---------------------------------------------------------------------------
// Read: everything the module needs in one round trip
// ---------------------------------------------------------------------------
export const getTaxExemptionsData = createServerFn().handler(async (): Promise<TaxExemptionData> => {
  if (!isDatabaseConfigured()) {
    return { configured: false, exemptions: [], expired: [], upcoming: [], active: [] };
  }
  try {
    const auth = await requireAuth();
    const db = sql();
    const today = todayStr();
    const rows = await db<TaxExemptionRow[]>`
      SELECT id, identifier_type, identifier_number, jurisdiction, entity,
             to_char(expires_on, 'YYYY-MM-DD') AS expires_on, contact, notes,
             created_at::text AS created_at, updated_at::text AS updated_at
      FROM tax_exemptions
      WHERE operation_id = ${auth.operationId}
      ORDER BY (expires_on IS NULL), expires_on, identifier_type, id`;

    const exemptions: TaxExemptionRow[] = rows.map((r) => ({
      ...r,
      expires_on: r.expires_on ?? null,
      status: computeStatus(r.expires_on, today),
    }));

    return {
      configured: true,
      exemptions,
      expired: exemptions.filter((e) => e.status === "expired"),
      upcoming: exemptions.filter((e) => e.status === "upcoming"),
      active: exemptions.filter((e) => e.status === "ok" || e.status === "none"),
    };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      exemptions: [],
      expired: [],
      upcoming: [],
      active: [],
    };
  }
});

// ---------------------------------------------------------------------------
// Write: save registry row (insert or update)
// ---------------------------------------------------------------------------
export const saveTaxExemption = createServerFn({ method: "POST" })
  .validator(parseInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const e = data;
      if (e.id) {
        const updated = await db`
          UPDATE tax_exemptions SET identifier_type=${e.identifier_type},
            identifier_number=${e.identifier_number}, jurisdiction=${e.jurisdiction},
            entity=${e.entity}, expires_on=${e.expires_on}, contact=${e.contact},
            notes=${e.notes}, updated_at=now()
          WHERE id=${e.id} AND operation_id=${auth.operationId} RETURNING id`;
        if (updated.length === 0) return { ok: false, error: `Registry record #${e.id} no longer exists.` };
        return { ok: true, id: e.id };
      }
      const [row] = await db<[{ id: number }]>`
        INSERT INTO tax_exemptions (operation_id, identifier_type, identifier_number, jurisdiction, entity, expires_on, contact, notes)
        VALUES (${auth.operationId}, ${e.identifier_type}, ${e.identifier_number}, ${e.jurisdiction}, ${e.entity}, ${e.expires_on}, ${e.contact}, ${e.notes})
        RETURNING id`;
      return { ok: true, id: row.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

// ---------------------------------------------------------------------------
// Write: delete registry row
// ---------------------------------------------------------------------------
const parseDeleteInput = (raw: unknown): { id: number } => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const id = optionalInt(d.id);
  if (!id) throw new Error("Registry record id is required.");
  return { id };
};

export const deleteTaxExemption = createServerFn({ method: "POST" })
  .validator(parseDeleteInput)
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      const del = await db`DELETE FROM tax_exemptions WHERE id=${data.id} AND operation_id=${auth.operationId} RETURNING id`;
      if (del.length === 0) return { ok: false, error: `Registry record #${data.id} no longer exists.` };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
