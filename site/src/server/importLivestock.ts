// ============================================================================
// Ranch Manager Pro — Livestock CSV import (Item 3, owner-approved private
// beta): safe, staged, owner-only bulk import of animal records.
//
// THIS module is the CLIENT-SAFE public surface (what routes import). It must
// contain NO server-only imports: nothing from node:, no "~/db" value imports,
// no ./authServer. Server-only machinery (fingerprint hashing, DB readers, the
// transactional commit core, auth enforcement) lives in ./importLivestockServer
// and is lazy-loaded by the createServerFn handlers below — exactly the
// auth.ts / authServer.ts split. The pure helpers here are unit-tested without
// a database; the DB-backed tests target the server module against a LOCAL
// Postgres only (they refuse to run unless DATABASE_URL points at 127.0.0.1 —
// the owner's Neon is never used).
//
// SAFETY MODEL (deliberate, spec-ratified):
//   • Owner-only. requireAuth() + role === 'owner' on BOTH the parse and the
//     commit endpoints; workers/viewers get a friendly error. `auth.userId`
//     becomes the audit row's user_id and `auth.operationId` scopes every
//     insert — there is NO Default-Operation fallback.
//   • CSV only. .csv extension AND text/csv-ish content type; anything else is
//     rejected up front. Max 1 MB, max 2,000 data rows — whole-file reject on
//     either, never partial processing.
//   • Preview-before-write. parseLivestockCsv() reads/parses/validates the
//     whole file and returns a full review session (per-row statuses, counts,
//     fingerprint, prior-import warning) WITHOUT touching the database (zero
//     writes at parse time). Only the explicit commit endpoint writes.
//   • Fingerprint duplicate guard. SHA-256 of the normalized CSV (trimmed
//     lines; header + data; not sensitive to a trailing blank line). A file
//     whose fingerprint already has a successful import row for this operation
//     requires an explicit "Import anyway?" acknowledgment — never auto-skip,
//     never silently duplicate.
//   • Transactional commit. One transaction inserts every ready + not-excluded
//     row and writes the audit row; ANY unexpected error rolls back everything
//     (all-or-nothing). Duplicate-tagged rows are DELIBERATELY skipped (the UI
//     shows their reason) so a single bad row can never abort a bulk import;
//     exclusion toggles are re-validated against row status at commit.
//   • No raw retention. File bytes are never stored; the audit row holds only
//     fingerprint + derived counts. Nothing else references the upload.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { ANIMAL_STATUSES, SEXES, SPECIES } from "~/types/livestock";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BREED,
  IMPORT_MAX_NAME,
  IMPORT_MAX_NOTES,
  IMPORT_MAX_PASTURE,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_TAG,
  IMPORT_ROW_STATUSES,
  type ImportColumnMapping,
  type ImportField,
  type ImportPrevious,
  type ImportReviewRow,
  type ImportRowStatus,
  type ImportRowValue,
  type LivestockImportResult,
  type LivestockImportSession,
} from "~/types/importLivestock";

export { IMPORT_ROW_STATUSES };

// ---------------------------------------------------------------------------
// CSV parsing (pure) — no database, no auth; unit-tested directly.
// ---------------------------------------------------------------------------

/** Split a CSV text into records per a small RFC-4180 reader (quoted fields,
 *  doubled quotes, \r\n or \n lines). Writer-side safety: our import output is
 *  only the app's own templates; this reader handles real-world spreadsheets
 *  (quoted commas/newlines). Pure + total — returns [] for empty input. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type CsvParseFailure = { ok: false; error: string };
export type CsvParseOk = {
  ok: true;
  headers: string[];
  data: string[][]; // zero-based data row arrays, aligned with headers
};
export type CsvParseResult = CsvParseOk | CsvParseFailure;

/** Parse a CSV string into headers + data rows with the app's limits:
 *  exactly one header row (first non-empty record) is required; 1..2000 data
 *  rows allowed; every data row is PADDED to the header length (blank cells —
 *  spreadsheets routinely drop trailing empty columns), never truncated.
 *  Returns a fatal error when the file has no header, no data, or exceeds
 *  2,000 data rows (whole-file reject, no partial processing). */
export function parseCsvWithLimits(text: string): CsvParseResult {
  const records = parseCsv(text);
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) return { ok: false, error: "The file is empty — nothing to import." };
  const headers = nonEmpty[0].map((h) => h.trim());
  const dataRecords = nonEmpty.slice(1);
  if (dataRecords.length > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `This file has ${dataRecords.length.toLocaleString()} data rows — the limit is ${IMPORT_MAX_ROWS.toLocaleString()}. Split it into smaller files and import them one at a time.`,
    };
  }
  const data = dataRecords.map((r) => {
    const pad = Array.from({ length: headers.length - r.length }, () => "");
    return r.concat(pad);
  });
  return { ok: true, headers, data };
}

/** CSV-escape one field (RFC 4180) — used when serializing a row for the
 *  review display. */
export function csvQuote(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// ---------------------------------------------------------------------------
// Field mapping (pure) — smart guess + validation
// ---------------------------------------------------------------------------

/** Normalize a raw CSV header name for matching: trim, lowercase, strip
 *  non-alphanumerics except _, collapse spaces. */
export function normalizeHeaderName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The app field a header name most plausibly maps to, or null (ignore). */
export function guessFieldForHeader(raw: string): ImportField | null {
  const norm = normalizeHeaderName(raw);
  if (!norm) return null;
  if (norm === "tag" || norm === "tag_number" || norm === "ear_tag" || norm === "animal_id" || norm === "id") {
    return "tag_number";
  }
  if (norm === "species" || norm === "animal_species" || norm === "type") return "species";
  if (norm === "name" || norm === "animal_name" || norm === "animal") return "name";
  if (norm === "sex" || norm === "gender") return "sex";
  if (norm === "breed" || norm === "cross" || norm === "breed_cross") return "breed";
  if (norm === "birth_date" || norm === "birthdate" || norm === "dob" || norm === "date_of_birth") {
    return "birth_date";
  }
  if (norm === "acquisition_date" || norm === "acquisition" || norm === "acquired" || norm === "purchase_date" || norm === "date_acquired") {
    return "acquisition_date";
  }
  if (norm === "status" || norm === "animal_status") return "status";
  if (norm === "pasture" || norm === "location" || norm === "current_pasture" || norm === "current_location") {
    return "pasture";
  }
  if (norm === "notes" || norm === "note" || norm === "comments" || norm === "remarks") return "notes";
  return null;
}

/** Default column mapping for a header list (pure): each header gets its
 *  guessed field; two CSV columns guessing the SAME app field keep only the
 *  FIRST (later ones become ignore — the review table surfaces any conflict
 *  via a warning banner). */
export function defaultMapping(headers: string[]): ImportColumnMapping[] {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const guess = guessFieldForHeader(h);
    if (guess === null || used.has(guess)) return { column: h, field: null };
    used.add(guess);
    return { column: h, field: guess };
  });
}

/** Validate a user-edited mapping: tag_number + species must be mapped to some
 *  column (the two required fields), a field may be mapped at most once, and
 *  only known app fields are assignable. Returns a human error or null. */
export function validateMapping(mapping: ImportColumnMapping[]): string | null {
  const counts = new Map<ImportField | null, number>();
  for (const m of mapping) counts.set(m.field, (counts.get(m.field) ?? 0) + 1);
  for (const f of IMPORT_FIELDS) {
    if ((counts.get(f) ?? 0) > 1) {
      return `The "${f}" field is mapped to more than one column — each app field can only come from one CSV column.`;
    }
  }
  if ((counts.get("tag_number") ?? 0) === 0) {
    return "Tag / animal ID must be mapped to a column — it is required for every row.";
  }
  if ((counts.get("species") ?? 0) === 0) {
    return "Species must be mapped to a column — it is required for every row.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row extraction + validation (pure)
// ---------------------------------------------------------------------------

/** Pull each CSV data row into an ImportRowValue using the mapping. The value
 *  for an app field is the trimmed text of the mapped column, or null when the
 *  column is ignored or the value is blank. `null` here is "blank" — exactly
 *  what parseAnimalInput's optional columns treat as unset. */
export function extractRow(mapping: ImportColumnMapping[], csvRow: string[]): ImportRowValue {
  const out: ImportRowValue = {
    tag_number: null,
    species: null,
    name: null,
    sex: null,
    breed: null,
    birth_date: null,
    acquisition_date: null,
    status: null,
    pasture: null,
    notes: null,
  };
  mapping.forEach((m, i) => {
    if (m.field === null) return;
    const raw = csvRow[i] ?? "";
    const val = raw.trim();
    if (val.length > 0) out[m.field] = val;
  });
  return out;
}

/** Normalize a tag: trim + collapse interior whitespace. Blank → null. */
export function normalizeTag(raw: string | null): string | null {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate one extracted row into a status + reason. `existingTags` is the set
 *  of tags already in THIS operation (for dup-existing); `seenTags` is the
 *  running set of tags seen earlier in THIS file (dup-in-file); both are
 *  mutable over the file. Species is required AND must be in the enum; tag is
 *  required; every other value, when present, must match the app's accepted
 *  vocabulary/lengths/dates exactly (same rules saveAnimal's validator
 *  enforces). Returns [status, reason]. */
export function validateImportRow(
  v: ImportRowValue,
  existingTags: Set<string>,
  seenTags: Set<string>
): [ImportRowStatus, string] {
  const tag = normalizeTag(v.tag_number);
  if (!tag) return ["missing", "Tag / animal ID is blank — every animal needs one."];
  if (tag.length > IMPORT_MAX_TAG) {
    return ["invalid", `Tag is too long (${tag.length} chars, max ${IMPORT_MAX_TAG}).`];
  }
  const seen = seenTags.has(tag);
  if (!seen) seenTags.add(tag);
  if (seen) return ["dup-in-file", `Tag ${tag} appears more than once in this file — only the first row with this tag imports.`];
  if (existingTags.has(tag)) return ["dup-existing", `Tag ${tag} already exists in this ranch — use a different tag or leave that row out.`];

  const species = v.species?.trim().toLowerCase() ?? "";
  if (!species) return ["missing", "Species is blank — every animal needs cattle, horse, goat, or sheep."];
  if (!(SPECIES as readonly string[]).includes(species)) {
    return ["invalid", `Species "${v.species}" isn't one of cattle, horse, goat, or sheep.`];
  }

  const sex = v.sex?.trim().toLowerCase() ?? "";
  if (sex && !(SEXES as readonly string[]).includes(sex)) return ["invalid", `Sex "${v.sex}" isn't one of female, male, or castrated.`];
  const status = v.status?.trim().toLowerCase() ?? "";
  if (status && !(ANIMAL_STATUSES as readonly string[]).includes(status)) {
    return ["invalid", `Status "${v.status}" isn't one of the accepted statuses.`];
  }
  if (v.name && v.name.length > IMPORT_MAX_NAME) return ["invalid", `Name is too long (${v.name.length} chars, max ${IMPORT_MAX_NAME}).`];
  if (v.breed && v.breed.length > IMPORT_MAX_BREED) return ["invalid", `Breed is too long (${v.breed.length} chars, max ${IMPORT_MAX_BREED}).`];
  if (v.pasture && v.pasture.length > IMPORT_MAX_PASTURE) return ["invalid", `Pasture is too long (${v.pasture.length} chars, max ${IMPORT_MAX_PASTURE}).`];
  if (v.notes && v.notes.length > IMPORT_MAX_NOTES) return ["invalid", `Notes are too long (${v.notes.length} chars, max ${IMPORT_MAX_NOTES}).`];

  for (const key of ["birth_date", "acquisition_date"] as const) {
    const d = v[key];
    if (d) {
      if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
        return ["invalid", `${key === "birth_date" ? "Birth date" : "Acquisition date"} "${d}" isn't a YYYY-MM-DD date.`];
      }
    }
  }
  return ["ready", ""];
}

/** Display a row's values as one quoted CSV line, for the review list. */
export function rowToDisplayLine(values: ImportRowValue): string {
  return [
    values.tag_number ?? "",
    values.species ?? "",
    values.name ?? "",
    values.sex ?? "",
    values.breed ?? "",
    values.birth_date ?? "",
    values.acquisition_date ?? "",
    values.status ?? "",
    values.pasture ?? "",
    values.notes ?? "",
  ]
    .map(csvQuote)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Shared per-row insert normalization (pure)
// ---------------------------------------------------------------------------

/** Normalize an extracted row into the exact insert shape saveAnimal uses.
 *  Only called on rows already validated as `ready` (so every value is
 *  acceptable); species/status are lowercased like saveAnimal's validator, and
 *  blanks become null. Import never sets herd_group_id (the CSV vocabulary has
 *  no group column) and never edits an existing animal. */
export function rowToAnimalInput(v: ImportRowValue) {
  const species = (v.species ?? "").trim().toLowerCase() as (typeof SPECIES)[number];
  const status = ((v.status ?? "").trim().toLowerCase() || "active") as (typeof ANIMAL_STATUSES)[number];
  const sex = ((v.sex ?? "").trim().toLowerCase() || null) as (typeof SEXES)[number] | null;
  return {
    species,
    name: (v.name ?? "").trim() || normalizeTag(v.tag_number) || "",
    tag_number: normalizeTag(v.tag_number),
    sex,
    breed: v.breed?.trim() || null,
    birth_date: v.birth_date?.trim() || null,
    acquisition_date: v.acquisition_date?.trim() || null,
    status,
    herd_group_id: null,
    pasture: v.pasture?.trim() || null,
    notes: v.notes?.trim() || null,
  };
}

/** Build the full review session for a parsed CSV (pure): headers, mapping,
 *  per-row statuses, counts, fingerprint, prior-import record. No DB writes. */
export function buildReviewSession(params: {
  headers: string[];
  data: string[][];
  fingerprint: string;
  existingTags: Set<string>;
  prevImport: ImportPrevious | null;
}): Omit<LivestockImportSession, "configured" | "error" | "filename" | "rowLimitHit"> {
  const { headers, data, fingerprint, existingTags, prevImport } = params;
  const mapping = defaultMapping(headers);
  const seen = new Set<string>();
  const rows: ImportReviewRow[] = data.map((csvRow, i) => {
    const values = extractRow(mapping, csvRow);
    const [status, reason] = validateImportRow(values, existingTags, seen);
    return {
      index: i,
      status,
      reason,
      values,
      tag_number: normalizeTag(values.tag_number),
    };
  });
  return {
    headers,
    mapping,
    rows,
    existingTags: [...existingTags],
    fingerprint,
    prevImport,
  };
}

// ---------------------------------------------------------------------------
// Public server functions (client-callable). Handlers lazy-load
// ./importLivestockServer so the client bundle stays free of ./importLivestockServer
// / ~/db / node:crypto — the TanStack client transform replaces these handler
// bodies with RPC stubs, so the dynamic imports never enter the browser.
// ---------------------------------------------------------------------------

type ParseInput = { name: string; text: string; bytes: number; mime: string };
const parseValidator = (raw: unknown): ParseInput => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const text = typeof d.text === "string" ? d.text : "";
  const bytes = typeof d.bytes === "number" && Number.isFinite(d.bytes) ? d.bytes : 0;
  const mime = typeof d.mime === "string" ? d.mime.toLowerCase() : "";
  return { name, text, bytes, mime };
};

type CommitInput = {
  csvText: string;
  mapping: ImportColumnMapping[];
  excludedIndices: number[];
  accepted: boolean;
  filename: string;
};
const commitValidator = (raw: unknown): CommitInput => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const csvText = typeof d.csvText === "string" ? d.csvText : "";
  const mapping = Array.isArray(d.mapping)
    ? (d.mapping as unknown[]).map((m) => {
        const mm = (m ?? {}) as Record<string, unknown>;
        const field = typeof mm.field === "string" && mm.field.length ? mm.field : null;
        return {
          column: typeof mm.column === "string" ? mm.column : "",
          field: field as ImportField | null,
        };
      })
    : [];
  const excludedIndices = Array.isArray(d.excludedIndices)
    ? d.excludedIndices.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
  return {
    csvText,
    mapping,
    excludedIndices,
    accepted: d.accepted === true,
    filename: typeof d.filename === "string" ? d.filename.trim() : "livestock.csv",
  };
};

/** Parse endpoint — owner-only. Reads the file's FULL text once, applies the
 *  file allowlist (CSV, ≤1 MB, ≤2,000 rows), parses + validates every row
 *  against the operation's existing tags, computes the fingerprint + prior
 *  import, and returns the review session. ZERO database writes. The raw
 *  bytes are discarded here — only the derived session survives (and the
 *  client keeps the File for the commit step, which re-reads it). */
export const parseLivestockCsv = createServerFn({ method: "POST" })
  .validator(parseValidator)
  .handler(async ({ data }): Promise<LivestockImportSession> => {
    const srv = await import("./importLivestockServer");
    return srv.parseLivestockCsvCore(data);
  });

/** Commit endpoint — owner-only + transactional. The client sends the SAME
 *  file text it parsed (re-read from the File object), the confirmed mapping,
 *  the excluded indices, and the duplicate-file acknowledgment; the server
 *  re-validates everything and inserts inside one transaction. */
export const importLivestockCommit = createServerFn({ method: "POST" })
  .validator(commitValidator)
  .handler(async ({ data }): Promise<LivestockImportResult> => {
    const srv = await import("./importLivestockServer");
    return srv.importLivestockCommitCore(data);
  });