// ============================================================================
// Ranch Manager Pro — Onboarding + CSV template tests (bun test)
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
//     bun test src/server/onboarding.test.ts
//
// Covers — against a REAL local Postgres (migration 0016 applied via
// runMigrations):
//   • parseOnboardingInput validation (operation type enum, positive acres,
//     length caps)
//   • setupStepKeys / setupProgress pure checklist math (5 steps)
//   • onboarding save/update scoped to the right operation (insert + upsert)
//   • cross-operation isolation: Ranch B cannot read/update Ranch A's profile
//     (the UPDATE ... WHERE operation_id shape affects zero rows)
//   • template content matches the app's accepted enum values (lazy-imported
//     from the module types — pure assertions, no DB, no auth)
//   • CSV safety: header row + example row + legend, no formulas/links/macros
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import {
  buildTemplateCsv,
  csvField,
  markTemplatesCore,
  parseOnboardingInput,
  readOnboardingCore,
  renameOperationCore,
  setupProgress,
  setupStepKeys,
  stampStartedCore,
  upsertProfileCore,
  type OnboardingDb,
} from "./onboarding";
import { ANIMAL_STATUSES, SEXES, SPECIES as LIVESTOCK_SPECIES } from "~/types/livestock";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, CONDITIONS, FUEL_TYPES } from "~/types/equipment";
import { HAY_TYPES, HAY_UNITS, FEED_CATEGORIES, FEED_UNITS } from "~/types/feed";
import { PASTURE_STATUSES } from "~/types/pasture";
import { EXPENSE_CATEGORIES } from "~/types/expenses";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "~/types/tasks";
import {
  OPERATION_TYPES,
  PRIMARY_SPECIES,
  SETUP_STEP_LABEL,
  TEMPLATES,
} from "~/types/onboarding";

let db: OnboardingDb;
let opAId: number;
let opBId: number;

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "onboarding.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0016_operation_onboarding.sql
  const [a] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Onboarding Test Ranch A') RETURNING id`;
  const [b] = await db<[{ id: number }]>`INSERT INTO operations (name) VALUES ('Onboarding Test Ranch B') RETURNING id`;
  opAId = a.id;
  opBId = b.id;
});

afterAll(async () => {
  // Operations cascade-delete their profile rows. Idempotent if a test failed.
  try {
    await db`DELETE FROM operations WHERE id = ${opAId} OR id = ${opBId}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

// ---------------------------------------------------------------------------
// parseOnboardingInput — validation
// ---------------------------------------------------------------------------

describe("parseOnboardingInput — operation type enum + positive acres", () => {
  test("accepts a full valid payload", () => {
    const out = parseOnboardingInput({
      location: "   Lane County, OR  ",
      operation_type: "cattle",
      acres: "1200.5",
      primary_species: "cattle",
    });
    expect(out).toEqual({
      location: "Lane County, OR",
      operation_type: "cattle",
      acres: 1200.5,
      primary_species: "cattle",
    });
  });

  test("blank/absent values become null (all onboarding fields optional)", () => {
    const out = parseOnboardingInput({});
    expect(out).toEqual({
      location: null,
      operation_type: null,
      acres: null,
      primary_species: null,
    });
  });

  test("rejects unlisted operation types (must match accepted enum)", () => {
    expect(() => parseOnboardingInput({ operation_type: "dairy" })).toThrow(/operation.type/);
    // Real accepted values never throw:
    for (const t of OPERATION_TYPES) {
      expect(() => parseOnboardingInput({ operation_type: t })).not.toThrow();
    }
  });

  test("acres: rejects zero, negatives, and junk; keeps decimals; rejects over-cap", () => {
    expect(() => parseOnboardingInput({ acres: "0" })).toThrow("Acres must be a positive number.");
    expect(() => parseOnboardingInput({ acres: "-5" })).toThrow("Acres must be a positive number.");
    expect(() => parseOnboardingInput({ acres: "abc" })).toThrow("Acres must be a positive number.");
    expect(parseOnboardingInput({ acres: "37.25" }).acres).toBe(37.25);
    expect(() => parseOnboardingInput({ acres: "100000" })).toThrow("Acres look too large");
  });

  test("length caps on location and primary_species", () => {
    expect(() => parseOnboardingInput({ location: "x".repeat(121) })).toThrow("Location is too long");
    expect(() => parseOnboardingInput({ primary_species: "x".repeat(81) })).toThrow("Primary species is too long");
  });
});

// ---------------------------------------------------------------------------
// setupStepKeys / setupProgress — 5-step checklist math (pure)
// ---------------------------------------------------------------------------

describe("setupStepKeys / setupProgress — 5-step checklist", () => {
  const empty = { operation_type: null, acres: null, primary_species: null, templates_downloaded: false };

  test("fresh operation: 4 missing steps → 1 of 5 done (name counts)", () => {
    const missing = setupStepKeys(empty);
    expect(missing.sort()).toEqual(["operation_type", "acres", "primary_species", "templates"].sort());
    const p = setupProgress(missing);
    expect(p.stepsTotal).toBe(5);
    expect(p.stepsDone).toBe(1);
    expect(p.done).toBe(false);
  });

  test("all fields filled → done, 5 of 5", () => {
    const missing = setupStepKeys({
      operation_type: "horses",
      acres: 40.5,
      primary_species: "horses",
      templates_downloaded: true,
    });
    expect(missing).toEqual([]);
    expect(setupProgress(missing).done).toBe(true);
    expect(setupProgress(missing).stepsDone).toBe(5);
  });

  test("templates only counts after a download; partial save is not done", () => {
    const partial = setupStepKeys({ operation_type: "cattle", acres: 100, primary_species: null, templates_downloaded: false });
    expect(partial).toContain("primary_species");
    expect(partial).toContain("templates");
    expect(setupProgress(partial).stepsDone).toBe(3);
    expect(setupProgress(partial).done).toBe(false);
    // With templates downloaded, 4 of 5 — still not done (species missing).
    const tpl = setupStepKeys({ operation_type: "cattle", acres: 100, primary_species: null, templates_downloaded: true });
    expect(setupProgress(tpl).stepsDone).toBe(4);
  });

  test("SETUP_STEP_LABEL defines exactly 5 steps", () => {
    expect(Object.keys(SETUP_STEP_LABEL).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// CSV template content — matches the app's accepted enum values exactly
// ---------------------------------------------------------------------------

describe("CSV templates — content matches the app's accepted values", () => {
  const csv = (slug: keyof typeof TEMPLATES) => buildTemplateCsv(slug);

  test("all six templates render a header comment, header row, example row, and legend block", () => {
    for (const slug of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
      const text = csv(slug);
      expect(text.split("\n").length > 6).toBe(true);
      expect(text.startsWith("# Ranch Manager Pro — ")).toBe(true);
      // header row line (2nd line)
      const headerLine = text.split("\n")[1];
      expect(headerLine).toBe(TEMPLATES[slug].fields.map((f) => f.name).join(","));
      expect(text).toContain("# FIELD DEFINITIONS");
      expect(text).toContain("# EXAMPLE ROW (delete before importing):");
    }
  });

  test("livestock template uses the exact animal enums (species/sex/status)", () => {
    const text = csv("livestock");
    for (const s of LIVESTOCK_SPECIES) expect(text).toContain(s);
    for (const s of SEXES) expect(text).toContain(s);
    for (const s of ANIMAL_STATUSES) expect(text).toContain(s);
    expect(text).toContain("tag_number");
    expect(text).toContain("birth_date");
    expect(text).toContain("YYYY-MM-DD");
  });

  test("pastures template uses pasture status enum + positive acres note", () => {
    const text = csv("pastures");
    for (const s of PASTURE_STATUSES) expect(text).toContain(s);
    expect(text).toContain("size_acres");
    expect(text).toContain("positive");
  });

  test("hay-feed template uses hay/feed enums (type, unit, category)", () => {
    const text = csv("hay-feed");
    for (const t of HAY_TYPES) expect(text).toContain(t);
    for (const u of HAY_UNITS) expect(text).toContain(u);
    for (const f of FEED_CATEGORIES) expect(text).toContain(f);
    for (const u of FEED_UNITS) expect(text).toContain(u);
    expect(text).toContain("bale_weight");
    expect(text).toContain("low_stock");
  });

  test("equipment template uses equipment enums (category/status/condition/fuel_type)", () => {
    const text = csv("equipment");
    for (const c of EQUIPMENT_CATEGORIES) expect(text).toContain(c);
    for (const s of EQUIPMENT_STATUSES) expect(text).toContain(s);
    for (const c of CONDITIONS) expect(text).toContain(c);
    for (const f of FUEL_TYPES) expect(text).toContain(f);
    expect(text).toContain("fuel_type");
  });

  test("expenses template uses the expense category enum", () => {
    const text = csv("expenses");
    for (const c of EXPENSE_CATEGORIES) expect(text).toContain(c);
    expect(text).toContain("amount");
    expect(text).toContain("vendor");
  });

  test("tasks template uses the task status/priority/category enums", () => {
    const text = csv("tasks");
    for (const s of TASK_STATUSES) expect(text).toContain(s);
    for (const p of TASK_PRIORITIES) expect(text).toContain(p);
    for (const c of TASK_CATEGORIES) expect(text).toContain(c);
    expect(text).toContain("due_date");
  });

  test("templates are safe: no formula-starter cells, no links, no PII-like examples", () => {
    for (const slug of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
      const text = csv(slug);
      // Check the DATA lines (header/example rows) — comment lines may say
      // "formulas or macros" by way of disclaimer.
      const dataLines = text.split("\n").filter((l) => l && !l.startsWith("#"));
      for (const line of dataLines) {
        for (const cell of line.split(",")) {
          // No spreadsheet formula starter characters at the start of any cell
          // (Excel/Sheets injection), no double-dash dates (Excel 97 style).
          expect(cell.trim()).not.toMatch(/^[=@+]/);
          expect(cell.trim()).not.toMatch(/^\-{2}/);
        }
      }
      expect(text).toContain("No formulas or macros");
      expect(text).not.toContain("http://");
      expect(text).not.toContain("https://");
      expect(text).not.toContain("=HYPERLINK");
      expect(text).not.toContain("@example");
      expect(text).not.toContain("john.doe");
    }
  });

  test("csvField quotes only when needed and doubles inner quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
});

// ---------------------------------------------------------------------------
// Onboarding lifecycle persisted against the local DB (same SQL shapes as the
// server fns, scoped by the operation we pass in)
// ---------------------------------------------------------------------------

describe("onboarding lifecycle (local DB, operation-scoped)", () => {
  test("save → profile row exists scoped to Ranch A only, setup shows 4 of 5", async () => {
    await upsertProfileCore(db, opAId, { operation_type: "cattle", acres: 1200, primary_species: "cattle" });
    await stampStartedCore(db, opAId);

    const profiles = await db<[{ operation_id: number }]>`
      SELECT operation_id FROM operation_profile WHERE operation_id = ${opAId}`;
    expect(profiles.length).toBe(1);

    const state = await readOnboardingCore(db, opAId);
    expect(state.operationName).toBe("Onboarding Test Ranch A");
    expect(state.profile?.operation_type).toBe("cattle");
    expect(state.profile?.acres).toBe(1200);
    expect(state.profile?.primary_species).toBe("cattle");
    expect(state.onboardingStartedAt).not.toBeNull();
    // name + operation_type + acres + primary_species done; only templates
    // missing → 4 of 5, setup not done.
    expect(state.setupDone).toBe(false);
    expect(state.missingSteps).toEqual(["templates"]);

    // Ranch B never sees Ranch A's profile — every read is scoped.
    const bProfiles = await db`SELECT operation_id FROM operation_profile WHERE operation_id = ${opBId}`;
    expect(bProfiles.length).toBe(0);
    const bState = await readOnboardingCore(db, opBId);
    expect(bState.profile).toBeNull();
    expect(bState.setupDone).toBe(false);
  });

  test("update → fields change on the SAME row (upsert, not duplicate)", async () => {
    await upsertProfileCore(db, opAId, {
      location: "Lane County, OR",
      operation_type: "mixed_ranch_farm",
      acres: 2200,
      primary_species: "horses",
    });
    const state = await readOnboardingCore(db, opAId);
    expect(state.profile?.operation_type).toBe("mixed_ranch_farm");
    expect(state.profile?.acres).toBe(2200);
    expect(state.profile?.primary_species).toBe("horses");
    const oneOp = await db<[{ n: number }]>`
      SELECT count(*)::int AS n FROM operation_profile WHERE operation_id = ${opAId}`;
    expect(Number(oneOp[0].n)).toBe(1);
  });

  test("completing all steps → setupDone true; template download flips the last step", async () => {
    // Fill species (templates still false) → 4 of 5.
    await upsertProfileCore(db, opAId, {
      operation_type: "mixed_ranch_farm",
      acres: 2200,
      primary_species: "horses",
    });
    let state = await readOnboardingCore(db, opAId);
    expect(state.setupDone).toBe(false);
    expect(state.missingSteps).toContain("templates");

    // Download a template (exact SQL shape markTemplatesDownloaded runs).
    await markTemplatesCore(db, opAId);
    state = await readOnboardingCore(db, opAId);
    expect(state.missingSteps).toEqual([]);
    expect(state.setupDone).toBe(true);
    expect(state.profile?.templates_downloaded).toBe(true);
  });

  test("renameOperationCore renames only Ranch A's row", async () => {
    expect(await renameOperationCore(db, opAId, "Copper Creek Ranch")).toBe(1);
    const [op] = await db<[{ name: string }]>`SELECT name FROM operations WHERE id = ${opAId}`;
    expect(op.name).toBe("Copper Creek Ranch");
    // B's name untouched.
    const [bOp] = await db<[{ name: string }]>`SELECT name FROM operations WHERE id = ${opBId}`;
    expect(bOp.name).toBe("Onboarding Test Ranch B");
  });
});

// ---------------------------------------------------------------------------
// Operation isolation — Ranch B cannot read OR update Ranch A's onboarding
// ---------------------------------------------------------------------------

describe("operation isolation — Ranch B cannot touch Ranch A's onboarding", () => {
  let aProfileId: number;

  beforeAll(async () => {
    const [row] = await db<[{ id: number }]>`
      SELECT id FROM operation_profile WHERE operation_id = ${opAId} ORDER BY id LIMIT 1`;
    aProfileId = row.id;
  });

  test("a read scoped to B sees none of A's profile rows", async () => {
    const rows = await db`
      SELECT id FROM operation_profile WHERE operation_id = ${opBId}`;
    expect(rows.length).toBe(0);
  });

  test("the exact UPDATE shape (WHERE id AND operation_id) affects zero rows from B", async () => {
    const updated = await db`
      UPDATE operation_profile SET primary_species = 'goats', updated_at = now()
      WHERE id = ${aProfileId} AND operation_id = ${opBId} RETURNING id`;
    expect(updated.length).toBe(0);

    // A's row is untouched.
    const [after] = await db<[{ primary_species: string }]>`
      SELECT primary_species FROM operation_profile WHERE id = ${aProfileId}`;
    expect(after.primary_species).toBe("horses");
  });

  test("the INSERT always carries an explicit operation_id — no default/blank writes", async () => {
    await upsertProfileCore(db, opBId, { operation_type: "horses", acres: 12, primary_species: "horses" });
    const [bRow] = await db<[{ operation_id: number }]>`
      SELECT operation_id FROM operation_profile WHERE operation_id = ${opBId}`;
    expect(bRow.operation_id).toBe(opBId);
    // A's profile still has exactly one row.
    const counts = await db<[{ n: number }]>`
      SELECT count(*)::int AS n FROM operation_profile WHERE operation_id = ${opAId}`;
    expect(Number(counts[0].n)).toBe(1);
  });

  test("operator/download stamps are scoped: B's download never marks A's row", async () => {
    // Sanitize: A currently done (templates_downloaded true). Flip A's flag off
    // directly to prove the scoped write path (not the flag itself).
    await db`UPDATE operation_profile SET templates_downloaded = false WHERE operation_id = ${opAId}`;
    // B downloads → only B's row flips.
    await markTemplatesCore(db, opBId);
    const [aRow] = await db<[{ templates_downloaded: boolean }]>`
      SELECT templates_downloaded FROM operation_profile WHERE operation_id = ${opAId}`;
    expect(aRow.templates_downloaded).toBe(false);
    const [bRow] = await db<[{ templates_downloaded: boolean }]>`
      SELECT templates_downloaded FROM operation_profile WHERE operation_id = ${opBId}`;
    expect(bRow.templates_downloaded).toBe(true);
  });
});

// Keep PRIMARY_SPECIES referenced (used by docs/tests on the species suggestions).
describe("onboarding suggested species", () => {
  test("primary species suggestions have a matching livestock species vocabulary entry", () => {
    const livestockVocab = LIVESTOCK_SPECIES as readonly string[];
    // Singular livestock values map to each plural suggestion.
    for (const s of PRIMARY_SPECIES) {
      const singular = s === "horses" ? "horse" : s.endsWith("s") ? s.slice(0, -1) : s;
      expect(livestockVocab).toContain(singular);
    }
  });
});