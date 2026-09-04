// ============================================================================
// Ranch Manager Pro — Livestock CSV import types (shared client + server).
// All values are JSON-safe so they cross the server/client boundary without
// React refusing to render them. The row-status shape below IS the review
// payload: the server parses + validates every row against the app's accepted
// enum values (the same lists the CSV templates and saveAnimal use), assigns
// each row exactly one mutually-exclusive status, and returns the whole file's
// verdict WITHOUT writing anything — preview-before-write (Item 3 spec).
// ============================================================================

/** App fields a livestock CSV can map to (the import column vocabulary). `id`
 * and `ranch_id` are intentionally NOT offered: records are always NEW (import
 * never edits existing animals) and ranch_id always comes from the session. */
export const IMPORT_FIELDS = [
  "tag_number",
  "species",
  "name",
  "sex",
  "breed",
  "birth_date",
  "acquisition_date",
  "status",
  "pasture",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  tag_number: "Tag / animal ID",
  species: "Species",
  name: "Name",
  sex: "Sex",
  breed: "Breed",
  birth_date: "Birth date",
  acquisition_date: "Acquisition date",
  status: "Status",
  pasture: "Pasture",
  notes: "Notes",
};

/** CSV column ↔ app field mapping. One entry per CSV column (in file order);
 * `field` is null when the column is ignored. Order matters for compatibility
 * with the server's zero-based row arrays (column i of every record is
 * interpreted as `mapping[i].field`). */
export type ImportColumnMapping = {
  column: string; // raw CSV header (trimmed) — displayed in the mapper
  field: ImportField | null; // null = "— ignore —"
};

/** A single imported record: raw values keyed by app field (null = blank) plus
 * the original tag value and the display CSV line. */
export type ImportRowValue = {
  tag_number: string | null;
  species: string | null;
  name: string | null;
  sex: string | null;
  breed: string | null;
  birth_date: string | null;
  acquisition_date: string | null;
  status: string | null;
  pasture: string | null;
  notes: string | null;
};

/** Per-row statuses (mutually exclusive). */
export const IMPORT_ROW_STATUSES = [
  "ready",
  "missing",
  "invalid",
  "dup-in-file",
  "dup-existing",
  "excluded",
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** One review row: status + human reason + the values that would be inserted
 * (or the raw tag for display). Row order matches the CSV (the UI keeps it so
 * the operator can find rows by sight). */
export type ImportReviewRow = {
  index: number; // 0-based CSV data row number (1 = first data row after header)
  status: ImportRowStatus;
  reason: string; // short plain-language explanation for status != ready
  values: ImportRowValue; // ready rows only (others may be partial)
  tag_number: string | null; // display key (raw, trimmed)
};

/** The full client-side import session state — what the UI renders between
 * "parse" and "commit". Nothing here is persisted server-side; the server
 * re-derives everything from the SAME file bytes at commit time. */
export type LivestockImportSession = {
  configured: boolean; // false when DATABASE_URL is missing
  error?: string; // parse-level fatal error (file type/size/row limit)
  filename: string;
  headers: string[]; // normalized CSV headers (trimmed, blank→"(blank col N)")
  mapping: ImportColumnMapping[]; // aligned with headers
  rows: ImportReviewRow[]; // full review set (even for huge files: capped at limit+1)
  rowLimitHit: boolean; // true when the file exceeded the 2,000 data-row cap
  existingTags: string[]; // tags already in this operation (dup-existing source)
  fingerprint: string; // SHA-256 of the normalized CSV (dup-import check)
  prevImport: ImportPrevious | null; // prior successful import of same fingerprint
};

export type ImportPrevious = {
  filename: string;
  importedRows: number;
  createdAt: string;
};

/** Commit-time counts/verdict returned to the UI. */
export type LivestockImportResult = {
  ok: boolean;
  error?: string; // commit-level fatal error (all-or-nothing rollback happened)
  imported?: number;
  skipped?: number; // rows that were ready but were skipped (dups / excluded)
  excluded?: number;
  total?: number;
  previous?: ImportPrevious | null; // set when the file was already imported
  accepted?: boolean; // client-side "duplicate file" acknowledgment checkbox
};

// ---------------------------------------------------------------------------
// File acceptance limits (Item 3 spec)
// ---------------------------------------------------------------------------

/** Max accepted upload size in bytes (1 MB). Whole-file reject — no partial
 * processing of an oversized file. */
export const IMPORT_MAX_BYTES = 1024 * 1024;
/** Max accepted data rows (after the header). Whole-file reject beyond it. */
export const IMPORT_MAX_ROWS = 2000;
/** Length caps, mirroring the form modal + template legend (characters). */
export const IMPORT_MAX_TAG = 40;
export const IMPORT_MAX_NAME = 120;
export const IMPORT_MAX_BREED = 60;
export const IMPORT_MAX_PASTURE = 80;
export const IMPORT_MAX_NOTES = 500;