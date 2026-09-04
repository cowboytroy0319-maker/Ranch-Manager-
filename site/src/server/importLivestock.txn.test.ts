// ============================================================================
// Ranch Manager Pro — Livestock CSV import: transactional commit tests (bun
// test, LOCAL Postgres only, never the owner's Neon).
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_import_txn_test \
//     bun test src/server/importLivestock.txn.test.ts
//
// Covers the "import once" lifecycle with a fresh cursor per test and the
// full transactional guarantees:
//   • preview-before-write: parsing/validation writes NOTHING (zero animals,
//     zero audit rows)
//   • commit writes ready + unexcluded rows atomically; excluded rows are
//     counted, never written
//   • a forced constraint failure mid-insert ROLLS BACK the whole batch — no
//     partial animals, no audit row (all-or-nothing; a recorded 'completed' is
//     always truthful)
//   • a rolled-back attempt leaves NO completed audit row that could block a
//     later retry
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import type { ImportColumnMapping } from "~/types/importLivestock";
import {
  buildReviewSession,
  parseCsvWithLimits,
} from "./importLivestock";
import {
  commitLivestockImportCore,
  existingTagsForOperation,
  findPreviousImport,
  fingerprintCsv,
} from "./importLivestockServer";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "importLivestock.txn.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

const db = sql();
let opId: number;
let userId: number;

const CSV = [
  "tag_number,species,name,sex,breed,birth_date,acquisition_date,status,pasture,notes",
  "SV-201,cattle,Belle,female,Angus,2022-03-14,,active,North Pasture,Replacement heifer",
  "SV-202,cattle,Junior,male,Hereford,2020-01-01,,,Pasture 2,",
  "SV-203,goat,Nanny,female,Boer,,2024-01-01,active,,Two kids",
  "SV-204,sheep,Wooly,castrated,Merino,,,active,Pasture 3,",
].join("\n");

const FULL_MAPPING: ImportColumnMapping[] = [
  { column: "tag_number", field: "tag_number" },
  { column: "species", field: "species" },
  { column: "name", field: "name" },
  { column: "sex", field: "sex" },
  { column: "breed", field: "breed" },
  { column: "birth_date", field: "birth_date" },
  { column: "acquisition_date", field: "acquisition_date" },
  { column: "status", field: "status" },
  { column: "pasture", field: "pasture" },
  { column: "notes", field: "notes" },
];

const auth = () => ({ operationId: opId, userId });

async function resetHerd() {
  await db`DELETE FROM animals WHERE ranch_id = ${opId}`;
  await db`DELETE FROM livestock_imports WHERE operation_id = ${opId}`;
}

beforeAll(async () => {
  await runMigrations(); // idempotent; includes 0017_livestock_imports.sql
  const [op] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Import Txn Ranch') RETURNING id`;
  opId = op.id;
  const [u] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash) VALUES ('import-txn@example.com', 'x') RETURNING id`;
  userId = u.id;
});

afterAll(async () => {
  try {
    await db`DELETE FROM operations WHERE id = ${opId}`;
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM users WHERE id = ${userId}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

describe("preview-before-write — the parse/review path writes NOTHING", () => {
  test("building a review session (mapping + statuses) creates zero rows and zero audits", async () => {
    await resetHerd();
    const parsed = parseCsvWithLimits(CSV);
    if (!parsed.ok) throw new Error(parsed.error);
    const existing = await existingTagsForOperation(db, opId);
    const session = buildReviewSession({
      headers: parsed.headers,
      data: parsed.data,
      fingerprint: fingerprintCsv(CSV),
      existingTags: existing,
      prevImport: await findPreviousImport(db, opId, fingerprintCsv(CSV)),
    });
    expect(session.rows.every((r) => r.status === "ready")).toBe(true);
    expect(session.rows.length).toBe(4);

    const animals = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opId}`;
    expect(Number(animals[0].n)).toBe(0); // NOTHING written at preview
    const audits = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM livestock_imports WHERE operation_id = ${opId}`;
    expect(Number(audits[0].n)).toBe(0);
  });
});

describe("commitLivestockImportCore — all-or-nothing + exclusions", () => {
  test("imports ready rows, counts excluded (never writes them), and writes the audit row", async () => {
    await resetHerd();
    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      // Exclude SV-203 (data row index 2) — must be counted, never imported.
      excludedIndices: [2],
      accepted: false,
      filename: "herd.csv",
      auth: auth(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.imported).toBe(3);
    expect(out.excluded).toBe(1);
    expect(out.total).toBe(4);

    const tags = await db<{ tag_number: string }[]>`
      SELECT tag_number FROM animals WHERE ranch_id = ${opId} ORDER BY tag_number`;
    expect(tags.map((t) => t.tag_number)).toEqual(["SV-201", "SV-202", "SV-204"]);
    // SV-204 arrived with status active (default) + name fallback to its tag.
    const nanny = await db`SELECT id FROM animals WHERE ranch_id = ${opId} AND tag_number = 'SV-203'`;
    expect(nanny.length).toBe(0);

    const audit = await db<{ excluded_rows: number; imported_rows: number }[]>`
      SELECT excluded_rows, imported_rows FROM livestock_imports WHERE operation_id = ${opId}`;
    expect(Number(audit[0].excluded_rows)).toBe(1);
    expect(Number(audit[0].imported_rows)).toBe(3);
  });

  test("forced unique-violation mid-insert rolls back the ENTIRE batch (no partial rows, no audit)", async () => {
    await resetHerd();
    // Plant a conflicting tag so the INSERT hits the ranch-scoped unique index.
    await db`INSERT INTO animals (species, name, tag_number, status, ranch_id)
      VALUES ('cattle', 'Sneaky', 'SV-201', 'active', ${opId})`;
    // Inject a STALE existing-tags reader (claims the herd is empty) — exactly
    // the live race between preview and commit.
    const staleExisting = async (): Promise<Set<string>> => new Set();

    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "herd.csv",
      auth: auth(),
      db,
      existingTagsForOperation: staleExisting,
      findPreviousImport,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("conflict");

    // All-or-nothing: the 3 ready rows were rolled back; only the planted row
    // exists; and NO audit row was written (a recorded 'completed' is always
    // truthful).
    const animals = await db<{ tag_number: string }[]>`
      SELECT tag_number FROM animals WHERE ranch_id = ${opId} ORDER BY tag_number`;
    expect(animals.map((a) => a.tag_number)).toEqual(["SV-201"]);
    const audits = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM livestock_imports WHERE operation_id = ${opId}`;
    expect(Number(audits[0].n)).toBe(0);
  });

  test("after a rolled-back attempt the same file imports cleanly (no stale completed audit)", async () => {
    await resetHerd();
    // The prior test rolled back; verify the fingerprint has NO completed
    // audit record for this operation, so a retry isn't blocked.
    const prev = await findPreviousImport(db, opId, fingerprintCsv(CSV));
    expect(prev).toBeNull();

    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "herd.csv",
      auth: auth(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.imported).toBe(4);

    const animals = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opId}`;
    expect(Number(animals[0].n)).toBe(4);
    const audits = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM livestock_imports WHERE operation_id = ${opId} AND status = 'completed'`;
    expect(Number(audits[0].n)).toBe(1);
  });
});