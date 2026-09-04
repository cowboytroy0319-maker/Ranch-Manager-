// ============================================================================
// Ranch Manager Pro — Livestock CSV import: SERVER-ONLY machinery.
// ----------------------------------------------------------------------------
// Imported ONLY via dynamic import() from the createServerFn handlers in
// ./importLivestock.ts (the auth.ts / authServer.ts pattern). Static imports
// here are fine because nothing client-facing statically imports THIS module.
// ============================================================================
import { createHash } from "node:crypto";
import { isDatabaseConfigured, sql } from "~/db";
import { requireAuth } from "./authServer";
import {
  IMPORT_MAX_BYTES,
  type ImportColumnMapping,
  type ImportPrevious,
  type LivestockImportResult,
  type LivestockImportSession,
} from "~/types/importLivestock";
import {
  buildReviewSession,
  extractRow,
  normalizeTag,
  parseCsvWithLimits,
  rowToAnimalInput,
  validateImportRow,
  validateMapping,
} from "./importLivestock";

export type ImportDb = ReturnType<typeof sql>;

// ---------------------------------------------------------------------------
// Fingerprint (pure, node:crypto) — duplicate-import detection
// ---------------------------------------------------------------------------

/**
 * Stable SHA-256 fingerprint of a CSV file's content: normalized = strip
 * leading/trailing whitespace per line, drop blank-only lines, and drop any
 * trailing blank line so the same content with/without a final newline hashes
 * identically. Header + data are both included (two different files that share
 * a header still differ). Pure and unit-tested.
 */
export function fingerprintCsv(text: string): string {
  const normalized = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .join("\n")
    .replace(/\s+$/, "");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Inject table readers (DB, operation-scoped)
// ---------------------------------------------------------------------------

/** Existing tags in one operation (dup-existing source). Scoped by
 *  operation_id; blank tags excluded (partial unique index behavior). */
export async function existingTagsForOperation(db: ImportDb, operationId: number): Promise<Set<string>> {
  const rows = await db<{ tag_number: string | null }[]>`
    SELECT tag_number FROM animals
    WHERE ranch_id = ${operationId} AND tag_number IS NOT NULL AND btrim(tag_number) <> ''`;
  return new Set(rows.map((r) => normalizeTag(r.tag_number)).filter((t): t is string => t !== null));
}

/** The most recent COMPLETED import of the same fingerprint for this operation
 *  (duplicate-import warning source), or null. */
export async function findPreviousImport(
  db: ImportDb,
  operationId: number,
  fingerprint: string
): Promise<ImportPrevious | null> {
  const rows = await db<{ filename: string; imported_rows: number; created_at: string }[]>`
    SELECT filename, imported_rows, created_at::text AS created_at
    FROM livestock_imports
    WHERE operation_id = ${operationId} AND fingerprint = ${fingerprint} AND status = 'completed'
    ORDER BY id DESC LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    filename: r.filename,
    importedRows: Number(r.imported_rows),
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Commit core (injectable, transactional, operation-scoped) — unit-tested
// ---------------------------------------------------------------------------

export type CommitImportOutcome =
  | { ok: true; imported: number; skipped: number; excluded: number; total: number; previous: ImportPrevious | null }
  | { ok: false; error: string };

export type CommitInput = {
  /** The full parsed CSV text — re-derived from the SAME original bytes the
   *  parse step saw (the client holds the file; nothing is stored). */
  csvText: string;
  /** The original upload filename — recorded in the audit row. */
  filename: string;
  /** The header → field mapping the owner confirmed in step 2. */
  mapping: ImportColumnMapping[];
  /** Indices (0-based data row numbers) the owner toggled OFF in review. */
  excludedIndices: number[];
  /** Client-side acknowledgment for a same-fingerprint prior import. */
  accepted: boolean;
  /** Resolved auth (injected by the caller: owner-only already enforced). */
  auth: { operationId: number; userId: number };
  /** Injectables for the DB ops (tests pass the same imported functions). */
  db: ImportDb;
  existingTagsForOperation: typeof existingTagsForOperation;
  findPreviousImport: typeof findPreviousImport;
};

type RowToInsert = ReturnType<typeof rowToAnimalInput> & { line: number };

/**
 * Transactional commit: re-parse + re-validate the SAME bytes (the server
 * never trusts client-side row statuses), then INSERT every ready + not
 * excluded row and the audit row in ONE transaction; any error rolls back.
 * Duplicate-tagged rows (dup-in-file / dup-existing) are deliberately SKIPPED
 * — never aborted — so one bad row can't block a bulk import. A same-content
 * file already imported for this operation requires `accepted`, or the whole
 * commit is refused (no silent duplicates). Nothing is ever written when the
 * commit fails.
 */
export async function commitLivestockImportCore(input: CommitInput): Promise<CommitImportOutcome> {
  const { csvText, mapping, excludedIndices, accepted, auth, db } = input;
  const fingerprint = fingerprintCsv(csvText);
  const excluded = new Set(excludedIndices);

  const prev = await input.findPreviousImport(db, auth.operationId, fingerprint);
  if (prev && !accepted) {
    return {
      ok: false,
      error:
        `This file looks like it was already imported on ${prev.createdAt} (${prev.importedRows} animals). ` +
        `Tick the confirmation box to import anyway.`,
    };
  }

  const parseResult = parseCsvWithLimits(csvText);
  if (!parseResult.ok) return { ok: false, error: parseResult.error };
  // Commit re-validates the mapping exactly like the parse endpoint did (a
  // starred owner could in theory forge a body; the server never trusts it).
  const mapErr = validateMapping(mapping);
  if (mapErr) return { ok: false, error: mapErr };

  const existing = await input.existingTagsForOperation(db, auth.operationId);
  const seen = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let excludedCount = 0;
  const insertRows: RowToInsert[] = [];

  parseResult.data.forEach((csvRow, i) => {
    const values = extractRow(mapping, csvRow);
    const [status] = validateImportRow(values, existing, seen);
    if (excluded.has(i)) {
      excludedCount += 1;
      return;
    }
    if (status === "ready") {
      insertRows.push({ ...rowToAnimalInput(values), line: i + 1 });
      imported += 1;
      return;
    }
    skipped += 1;
  });

  try {
    await db.begin(async (tx) => {
      if (insertRows.length > 0) {
        for (const r of insertRows) {
          await tx`
            INSERT INTO animals (species, name, tag_number, sex, breed, birth_date,
              acquisition_date, status, herd_group_id, pasture, notes, ranch_id)
            VALUES (${r.species}, ${r.name}, ${r.tag_number}, ${r.sex}, ${r.breed},
              ${r.birth_date}, ${r.acquisition_date}, ${r.status}, ${r.herd_group_id},
              ${r.pasture}, ${r.notes}, ${auth.operationId})`;
        }
      }
      await tx`
        INSERT INTO livestock_imports
          (operation_id, user_id, filename, fingerprint, total_rows, imported_rows, skipped_rows, excluded_rows, status)
        VALUES (${auth.operationId}, ${auth.userId}, ${input.filename}, ${fingerprint},
          ${parseResult.data.length}, ${insertRows.length}, ${skipped}, ${excludedCount}, 'completed')`;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tag uniqueness race (another import landed between parse and commit) is
    // the overwhelmingly likely failure; give the owner the actionable, honest
    // story instead of a raw constraint leak.
    if (/animals_ranch_tag_uniq|duplicate/i.test(msg)) {
      return {
        ok: false,
        error:
          "A tag in this file conflicts with the live herd (someone imported or added one since the preview). " +
          "Re-run the preview and exclude the conflicting rows.",
      };
    }
    return { ok: false, error: `Import failed — no rows were written. ${msg}` };
  }

  return {
    ok: true,
    imported: insertRows.length,
    skipped,
    excluded: excludedCount,
    total: parseResult.data.length,
    previous: prev,
  };
}

// ---------------------------------------------------------------------------
// Handler cores (auth + full pipeline) — called by the createServerFn stubs
// ---------------------------------------------------------------------------

export interface ParseInput {
  name: string;
  text: string;
  bytes: number;
  mime: string;
}

/** Parse core — owner-only. Zero database writes. */
export async function parseLivestockCsvCore(data: ParseInput): Promise<LivestockImportSession> {
  if (!isDatabaseConfigured()) {
    return { configured: false, filename: data.name, headers: [], mapping: [], rows: [], existingTags: [], fingerprint: "", prevImport: null, rowLimitHit: false };
  }
  const fail = (error: string): LivestockImportSession => ({
    configured: true,
    error,
    filename: data.name,
    headers: [],
    mapping: [],
    rows: [],
    existingTags: [],
    fingerprint: "",
    prevImport: null,
    rowLimitHit: false,
  });
  try {
    const auth = await requireAuth();
    if (auth.role !== "owner") {
      return fail("Only the ranch owner can import livestock records — ask the owner to import this file.");
    }
    // File allowlist: CSV only. Real .csv browser uploads send text/csv (or
    // application/vnd.ms-excel for some Windows setups); anything else is
    // rejected before any parsing happens.
    const looksCsvName = data.name.toLowerCase().endsWith(".csv");
    const looksCsvMime = data.mime === "text/csv" || data.mime === "application/vnd.ms-excel" || data.mime === "application/csv";
    if (!looksCsvName && !looksCsvMime) {
      return fail("That file type isn't a CSV. Please upload a .csv file (text/csv) — Excel, PDF, zip and other files can't be imported.");
    }
    if (data.bytes > IMPORT_MAX_BYTES) {
      return fail(`This file is ${(data.bytes / 1024 / 1024).toFixed(1)} MB — the limit is 1 MB. Trim it down and try again.`);
    }
    if (!data.text.trim()) return fail("The file is empty — nothing to import.");
    const parsed = parseCsvWithLimits(data.text);
    if (!parsed.ok) {
      return { ...fail(""), error: parsed.error, rowLimitHit: parsed.error.includes("limit") };
    }
    const db = sql();
    const fingerprint = fingerprintCsv(data.text);
    const [existing, prev] = await Promise.all([
      existingTagsForOperation(db, auth.operationId),
      findPreviousImport(db, auth.operationId, fingerprint),
    ]);
    const reviewed = buildReviewSession({
      headers: parsed.headers,
      data: parsed.data,
      fingerprint,
      existingTags: existing,
      prevImport: prev,
    });
    return {
      configured: true,
      filename: data.name,
      ...reviewed,
      rowLimitHit: false,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not read that file. Please try again.");
  }
}

export interface CommitInputData {
  csvText: string;
  mapping: ImportColumnMapping[];
  excludedIndices: number[];
  accepted: boolean;
  filename: string;
}

/** Commit core — owner-only + transactional. */
export async function importLivestockCommitCore(data: CommitInputData): Promise<LivestockImportResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
  try {
    const auth = await requireAuth();
    if (auth.role !== "owner") {
      return { ok: false, error: "Only the ranch owner can import livestock records." };
    }
    if (!data.csvText.trim()) return { ok: false, error: "The file is empty — nothing to import." };
    const db = sql();
    const outcome = await commitLivestockImportCore({
      csvText: data.csvText,
      mapping: data.mapping,
      excludedIndices: data.excludedIndices,
      accepted: data.accepted,
      filename: data.filename,
      auth: { operationId: auth.operationId, userId: auth.userId },
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return outcome;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Import failed — no rows were written." };
  }
}