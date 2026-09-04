// ============================================================================
// Ranch Manager Pro — Livestock CSV import: DB-backed duplicate/fingerprint +
// scope tests (bun test, LOCAL Postgres only, never the owner's Neon).
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_import_dedup_test \
//     bun test src/server/importLivestock.db.test.ts
//
// Covers, through the injectable commit core (commitLivestockImportCore) and
// the pure reviewer (buildReviewSession):
//   • commit writes ALL ready rows + an audit row inside one transaction
//   • duplicate re-import of the same fingerprint requires `accepted`:
//     without it the commit is refused (nothing written); with it, imports
//     again (preview warning surfaced by findPreviousImport)
//   • cross-operation isolation: tags in Ranch A do NOT collide with Ranch B
//     and audit rows are scoped per operation
//   • a commit that contradicts its own preview (a tag that landed between
//     preview and commit) fails closed — the transaction rolls back fully
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  commitLivestockImportCore,
  existingTagsForOperation,
  findPreviousImport,
  fingerprintCsv,
} from "./importLivestockServer";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1/.test(url)) {
  throw new Error(
    "importLivestock.db.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
      "The owner's Neon must never be used."
  );
}

const db = sql();
let opAId: number;
let opBId: number;
let userIdA: number;
let userIdB: number;

const CSV = [
  "tag_number,species,name,sex,breed,birth_date,acquisition_date,status,pasture,notes",
  "SV-101,cattle,Belle,female,Angus,2022-03-14,,active,North Pasture,Replacement heifer",
  "SV-102,cattle,Junior,male,Hereford,2020-01-01,,,Pasture 2,",
  "SV-103,goat,Nanny,female,Boer,,2024-01-01,active,,Two kids",
].join("\n");

const FULL_MAPPING = [
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

const authA = () => ({ operationId: opAId, userId: userIdA });
const authB = () => ({ operationId: opBId, userId: userIdB });

beforeAll(async () => {
  await runMigrations(); // idempotent; includes 0017_livestock_imports.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Import Test Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Import Test Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;
  const [uA] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash) VALUES ('import-db-a@example.com', 'x') RETURNING id`;
  const [uB] = await db<[{ id: number }]>`INSERT INTO users (email, password_hash) VALUES ('import-db-b@example.com', 'x') RETURNING id`;
  userIdA = uA.id;
  userIdB = uB.id;
});

afterAll(async () => {
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId}`; // cascades animals + audit
  } catch {
    /* best effort */
  }
  try {
    await db`DELETE FROM users WHERE email LIKE 'import-db-%'`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

describe("commitLivestockImportCore — happy path + audit", () => {
  test("imports every ready row in one transaction and records a truthful audit row", async () => {
    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "herd.csv",
      auth: authA(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.imported).toBe(3);
    expect(out.skipped).toBe(0);
    expect(out.total).toBe(3);

    const animals = await db<{ tag_number: string; ranch_id: number }[]>`
      SELECT tag_number, ranch_id FROM animals WHERE ranch_id = ${opAId} ORDER BY tag_number`;
    expect(animals.map((a) => a.tag_number)).toEqual(["SV-101", "SV-102", "SV-103"]);
    expect(animals.every((a) => a.ranch_id === opAId)).toBe(true);

    const audit = await db<{ fingerprint: string; imported_rows: number; status: string; user_id: number }[]>`
      SELECT fingerprint, imported_rows, status, user_id FROM livestock_imports WHERE operation_id = ${opAId}`;
    expect(audit.length).toBe(1);
    expect(audit[0].fingerprint).toBe(fingerprintCsv(CSV));
    expect(Number(audit[0].imported_rows)).toBe(3);
    expect(audit[0].status).toBe("completed");
    expect(audit[0].user_id).toBe(userIdA);
  });

  test("findPreviousImport sees the completed import for THIS operation", async () => {
    const prev = await findPreviousImport(db, opAId, fingerprintCsv(CSV));
    expect(prev).not.toBeNull();
    expect(prev?.importedRows).toBe(3);
    expect(prev?.filename).toBe("herd.csv");
    expect(prev?.createdAt).toBeTruthy();
  });

  test("Ranch B sees zero audit rows and zero animals from Ranch A (isolation)", async () => {
    const bAnimals = await db`SELECT id FROM animals WHERE ranch_id = ${opBId}`;
    expect(bAnimals.length).toBe(0);
    const bAudit = await db`SELECT id FROM livestock_imports WHERE operation_id = ${opBId}`;
    expect(bAudit.length).toBe(0);
    const bPrev = await findPreviousImport(db, opBId, fingerprintCsv(CSV));
    expect(bPrev).toBeNull();
  });

  test("the SAME tags in Ranch B do not collide with Ranch A (uniqueness per operation)", async () => {
    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "ranch-b-herd.csv",
      auth: authB(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.imported).toBe(3);
    const bAnimals = await db<{ ranch_id: number }[]>`
      SELECT ranch_id FROM animals WHERE ranch_id = ${opBId} ORDER BY tag_number`;
    expect(bAnimals.length).toBe(3);
    // The audit row for B is scoped to B.
    const bAudit = await db`SELECT operation_id FROM livestock_imports WHERE operation_id = ${opBId}`;
    expect(bAudit.length).toBe(1);
  });
});

describe("commitLivestockImportCore — duplicate-import fingerprint gate", () => {
  test("re-importing the same file WITHOUT accepted is refused and writes nothing", async () => {
    const before = await db<{ n: number }>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opAId}`;
    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "herd.csv",
      auth: authA(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("already imported");
    const after = await db<{ n: number }>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opAId}`;
    expect(Number(after[0].n)).toBe(Number(before[0].n)); // nothing written
  });

  test("re-importing with accepted=true imports again (explicit operator choice)", async () => {
    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: true,
      filename: "herd.csv",
      auth: authA(),
      db,
      existingTagsForOperation,
      findPreviousImport,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    // Tag uniqueness is per-operation and permanent — the same tags now
    // duplicate, so these rows are SKIPPED (never aborted, never silently
    // duplicated). No new animals exist.
    expect(out.imported).toBe(0);
    expect(out.skipped).toBe(3);
    const animals = await db<{ n: number }>`SELECT count(*)::int AS n FROM animals WHERE ranch_id = ${opAId}`;
    expect(Number(animals[0].n)).toBe(3);
    // A second completed audit row exists (the operator chose to re-import).
    const audits = await db`SELECT id FROM livestock_imports WHERE operation_id = ${opAId} AND status = 'completed'`;
    expect(audits.length).toBe(2);
  });
});

describe("commitLivestockImportCore — fails closed when the herd changed mid-flight", () => {
  test("a tag that landed between preview and commit rolls the whole transaction back", async () => {
    // Simulate the REAL race: the preview snapshot said "SV-101 is free" but
    // someone added SV-101 to the live herd AFTER the preview (before commit).
    // We inject a stale existing-tags reader (returns an empty set) so the
    // INSERT hits the ranch-scoped unique index mid-transaction — exactly what
    // a live-concurrent edit would do. The transaction must roll back
    // everything: zero imports, no audit row, only the planted row remains.
    await db`DELETE FROM animals WHERE ranch_id = ${opBId}`;
    await db`DELETE FROM livestock_imports WHERE operation_id = ${opBId}`;
    await db`INSERT INTO animals (species, name, tag_number, status, ranch_id)
      VALUES ('cattle', 'Sneaky', 'SV-101', 'active', ${opBId})`;

    const staleExisting = async (): Promise<Set<string>> => new Set(); // lies: SV-101 is free

    const out = await commitLivestockImportCore({
      csvText: CSV,
      mapping: FULL_MAPPING,
      excludedIndices: [],
      accepted: false,
      filename: "herd.csv",
      auth: authB(),
      db,
      existingTagsForOperation: staleExisting,
      findPreviousImport,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("conflict");
    }
    // All-or-nothing: the 2 ready rows were rolled back; only the planted row
    // exists; and no audit row was written (status 'completed' is truthful).
    const animals = await db<{ tag_number: string }[]>`
      SELECT tag_number FROM animals WHERE ranch_id = ${opBId} ORDER BY tag_number`;
    expect(animals.map((a) => a.tag_number)).toEqual(["SV-101"]);
    const bAudit = await db`SELECT id FROM livestock_imports WHERE operation_id = ${opBId}`;
    expect(bAudit.length).toBe(0);
  });
});