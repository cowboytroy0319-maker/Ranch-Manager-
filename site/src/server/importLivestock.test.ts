// ============================================================================
// Ranch Manager Pro — Livestock CSV import: PURE unit tests (bun test)
// Exercises the CSV reader, limits, fingerprint, mapping guesses, row
// extraction, and per-row validation WITHOUT touching a database.
//
//   bun test src/server/importLivestock.test.ts
//
// The DB-backed tests (importLivestock.db.test.ts / .txn.test.ts) cover the
// injectable commit core against a LOCAL Postgres only.
// ============================================================================
import { describe, expect, test } from "bun:test";
import {
  buildReviewSession,
  csvQuote,
  defaultMapping,
  extractRow,
  guessFieldForHeader,
  normalizeHeaderName,
  normalizeTag,
  parseCsv,
  parseCsvWithLimits,
  rowToAnimalInput,
  validateImportRow,
  validateMapping,
} from "./importLivestock";
import { fingerprintCsv } from "./importLivestockServer";
import { ANIMAL_STATUSES, SEXES, SPECIES } from "~/types/livestock";
import {
  IMPORT_MAX_BREED,
  IMPORT_MAX_NAME,
  IMPORT_MAX_NOTES,
  IMPORT_MAX_PASTURE,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_TAG,
} from "~/types/importLivestock";

// ---------------------------------------------------------------------------
// parseCsv — RFC-4180 reader
// ---------------------------------------------------------------------------

describe("parseCsv — RFC-4180 reader", () => {
  test("splits simple rows on commas", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("handles quoted commas, quoted newlines, and doubled quotes", () => {
    const text = 'tag,name,notes\nSV-1,"Belle, the cow","Line 1\nLine 2","say ""hi"""';
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(["tag", "name", "notes"]);
    expect(rows[1]).toEqual(["SV-1", "Belle, the cow", "Line 1\nLine 2", 'say "hi"']);
  });

  test("handles CRLF line endings and a trailing newline", () => {
    expect(parseCsv("a\r\nb\r\n")).toEqual([["a"], ["b"]]);
  });

  test("returns [] for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseCsvWithLimits — header required, data rows, caps
// ---------------------------------------------------------------------------

describe("parseCsvWithLimits — header + row caps", () => {
  test("first non-empty record is the header; data rows are padded to header length", () => {
    const res = parseCsvWithLimits("\ntag_number,species,name\nSV-1,cattle,Belle\nSV-2,horse\n");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.headers).toEqual(["tag_number", "species", "name"]);
    expect(res.data[0]).toEqual(["SV-1", "cattle", "Belle"]);
    // Trailing empty columns are padded (spreadsheets drop them).
    expect(res.data[1]).toEqual(["SV-2", "horse", ""]);
  });

  test("rejects an empty file with a friendly error", () => {
    const res = parseCsvWithLimits("");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("empty");
  });

  test("rejects more than 2,000 data rows — whole-file, no partial processing", () => {
    const header = "tag_number,species\n";
    const rows = "SV-1,cattle\n".repeat(IMPORT_MAX_ROWS + 1);
    const res = parseCsvWithLimits(header + rows);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("limit");
    if (!res.ok) expect(res.error).toContain((IMPORT_MAX_ROWS + 1).toLocaleString());
  });

  test("exactly 2,000 data rows is accepted", () => {
    const header = "tag_number,species\n";
    const rows = "SV-1,cattle\n".repeat(IMPORT_MAX_ROWS);
    const res = parseCsvWithLimits(header + rows);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.length).toBe(IMPORT_MAX_ROWS);
  });
});

// ---------------------------------------------------------------------------
// fingerprintCsv — duplicate-import detection (stable, whitespace-tolerant)
// ---------------------------------------------------------------------------

describe("fingerprintCsv — stable content fingerprint", () => {
  test("same content with and without a trailing newline hashes identically", () => {
    const a = "tag_number,species\nSV-1,cattle\n";
    const b = "tag_number,species\nSV-1,cattle";
    expect(fingerprintCsv(a)).toBe(fingerprintCsv(b));
  });

  test("inner content differences change the fingerprint", () => {
    const a = "tag_number,species\nSV-1,cattle\n";
    const b = "tag_number,species\nSV-2,cattle\n";
    expect(fingerprintCsv(a)).not.toBe(fingerprintCsv(b));
  });

  test("is always a 64-char hex digest", () => {
    expect(fingerprintCsv("tag_number,species\nSV-1,cattle\n")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Field mapping — smart guess + validation
// ---------------------------------------------------------------------------

describe("normalizeHeaderName / guessFieldForHeader", () => {
  test("normalizes case, spaces, and punctuation", () => {
    expect(normalizeHeaderName("  Tag Number ")).toBe("tag_number");
    expect(normalizeHeaderName("Acquisition-Date")).toBe("acquisition_date");
  });

  test("guesses common ranch spreadsheet headers", () => {
    expect(guessFieldForHeader("Tag")).toBe("tag_number");
    expect(guessFieldForHeader("Ear Tag")).toBe("tag_number");
    expect(guessFieldForHeader("Animal ID")).toBe("tag_number");
    expect(guessFieldForHeader("Species")).toBe("species");
    expect(guessFieldForHeader("Animal")).toBe("name");
    expect(guessFieldForHeader("Gender")).toBe("sex");
    expect(guessFieldForHeader("DOB")).toBe("birth_date");
    expect(guessFieldForHeader("Date Acquired")).toBe("acquisition_date");
    expect(guessFieldForHeader("Location")).toBe("pasture");
    expect(guessFieldForHeader("Comments")).toBe("notes");
  });

  test("unknown headers guess to null (ignore)", () => {
    expect(guessFieldForHeader("Vendor")).toBeNull();
    expect(guessFieldForHeader("")).toBeNull();
  });
});

describe("defaultMapping / validateMapping", () => {
  test("maps the six template-style headers to the six app fields", () => {
    const headers = ["tag_number", "name", "species", "sex", "breed", "birth_date", "status", "pasture", "notes"];
    const mapping = defaultMapping(headers);
    const fields = mapping.map((m) => m.field).filter(Boolean);
    expect(fields).toEqual(["tag_number", "name", "species", "sex", "breed", "birth_date", "status", "pasture", "notes"]);
  });

  test("a second column guessing an already-used field becomes ignore", () => {
    const mapping = defaultMapping(["tag_number", "species", "Tag"]);
    expect(mapping[0]?.field).toBe("tag_number");
    expect(mapping[1]?.field).toBe("species");
    expect(mapping[2]?.field).toBeNull();
  });

  test("validateMapping: missing tag or species is rejected; duplicate fields rejected", () => {
    expect(validateMapping(defaultMapping(["name", "sex"]))).toContain("Tag");
    expect(validateMapping(defaultMapping(["tag_number", "name", "sex"]))).toContain("Species");
    const dup = [
      { column: "a", field: "tag_number" },
      { column: "b", field: "tag_number" },
      { column: "c", field: "species" },
    ] as const;
    expect(validateMapping(dup as unknown as ReturnType<typeof defaultMapping>)).toContain("more than one");
  });
});

// ---------------------------------------------------------------------------
// Extract + validation — the per-row status machine
// ---------------------------------------------------------------------------

const fullMapping = [
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
] as const;

const fullRow = (over: Partial<Record<string, string>> = {}): string[] => {
  const base: Record<string, string> = {
    tag_number: "SV-101",
    species: "cattle",
    name: "Belle",
    sex: "female",
    breed: "Angus",
    birth_date: "2022-03-14",
    acquisition_date: "",
    status: "active",
    pasture: "North Pasture",
    notes: "Replacement heifer",
  };
  Object.assign(base, over);
  return fullMapping.map((m) => base[m.column as string] ?? "");
};

describe("extractRow — column → field values", () => {
  test("maps each mapped column into the row value; blanks stay null", () => {
    const v = extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ acquisition_date: "2024-05-01" }));
    expect(v.tag_number).toBe("SV-101");
    expect(v.species).toBe("cattle");
    expect(v.acquisition_date).toBe("2024-05-01");
    expect(v.sex).toBe("female");
  });

  test("ignored columns are dropped", () => {
    const mapping = [
      { column: "foo", field: null },
      { column: "tag_number", field: "tag_number" },
      { column: "species", field: "species" },
    ] as const;
    const v = extractRow(mapping as unknown as ReturnType<typeof defaultMapping>, ["junk", "SV-1", "goat"]);
    expect(v.tag_number).toBe("SV-1");
    expect(v.species).toBe("goat");
  });
});

describe("validateImportRow — statuses are mutually exclusive", () => {
  const emptyExisting = new Set<string>();
  const freshSeen = () => new Set<string>();

  test("ready when required fields are present and values are acceptable", () => {
    const seen = freshSeen();
    const [s, r] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow()), emptyExisting, seen);
    expect(s).toBe("ready");
    expect(r).toBe("");
  });

  test("missing when the tag is blank", () => {
    const [s, r] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ tag_number: "  " })), emptyExisting, freshSeen());
    expect(s).toBe("missing");
    expect(r).toContain("Tag");
  });

  test("missing when species is blank", () => {
    const [s, r] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ species: "" })), emptyExisting, freshSeen());
    expect(s).toBe("missing");
    expect(r).toContain("Species");
  });

  test("invalid when species is not in the enum", () => {
    const [s, r] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ species: "alpaca" })), emptyExisting, freshSeen());
    expect(s).toBe("invalid");
    expect(r).toContain("alpaca");
  });

  test("invalid on bad dates (not YYYY-MM-DD)", () => {
    const [s, r] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ birth_date: "03/14/2022" })), emptyExisting, freshSeen());
    expect(s).toBe("invalid");
    expect(r).toContain("YYYY-MM-DD");
    const [s2] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ acquisition_date: "2022-13-45" })), emptyExisting, freshSeen());
    expect(s2).toBe("invalid");
  });

  test("invalid on unknown sex/status values", () => {
    const [s1] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ sex: "unknown" })), emptyExisting, freshSeen());
    expect(s1).toBe("invalid");
    const [s2] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ status: "retired" })), emptyExisting, freshSeen());
    expect(s2).toBe("invalid");
  });

  test("invalid on over-length values", () => {
    const [s] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ name: "x".repeat(IMPORT_MAX_NAME + 1) })), emptyExisting, freshSeen());
    expect(s).toBe("invalid");
    const [s2] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ notes: "y".repeat(IMPORT_MAX_NOTES + 1) })), emptyExisting, freshSeen());
    expect(s2).toBe("invalid");
    const [s3] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ breed: "z".repeat(IMPORT_MAX_BREED + 1) })), emptyExisting, freshSeen());
    expect(s3).toBe("invalid");
    const [s4] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ pasture: "p".repeat(IMPORT_MAX_PASTURE + 1) })), emptyExisting, freshSeen());
    expect(s4).toBe("invalid");
  });

  test("dup-in-file beats dup-existing for a tag seen earlier in the file", () => {
    const seen = freshSeen();
    const existing = new Set(["SV-101"]);
    const first = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ tag_number: "SV-101" })), existing, seen);
    expect(first[0]).toBe("dup-existing"); // against the live herd
    const second = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ tag_number: "SV-101" })), existing, seen);
    expect(second[0]).toBe("dup-in-file"); // same tag appears twice in THIS file
  });

  test("blank tag never collides (no missing-tag row can be a dup)", () => {
    const seen = new Set([""]);
    const [s] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ tag_number: "" })), new Set([""]), seen);
    expect(s).toBe("missing");
  });

  test("species/sex/status values are exactly the app's enums (every enum value passes)", () => {
    for (const sp of SPECIES) {
      const [s] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ species: sp })), emptyExisting, freshSeen());
      expect(s).toBe("ready");
    }
    for (const x of SEXES) {
      const [s] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ sex: x })), emptyExisting, freshSeen());
      expect(s).toBe("ready");
    }
    for (const st of ANIMAL_STATUSES) {
      const [s] = validateImportRow(extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ status: st })), emptyExisting, freshSeen());
      expect(s).toBe("ready");
    }
  });
});

// ---------------------------------------------------------------------------
// buildReviewSession — end-to-end preview
// ---------------------------------------------------------------------------

describe("buildReviewSession — the full preview session", () => {
  test("produces statuses for every row with counts and reasons", () => {
    const csv = [
      "tag_number,species,name,sex,breed,birth_date,acquisition_date,status,pasture,notes",
      "SV-101,cattle,Belle,female,Angus,2022-03-14,,active,North Pasture,Replacement heifer",
      "SV-102,cattle,,male,Hereford,2020-01-01,,,Pasture 2,",
      ",horse,Blank Tag,,,,,,,",
      "SV-103,goat,Nanny,,Boer,,2024-01-01,active,,Two kids",
      "SV-102,cattle,Duplicate,,,2020-01-01,,,,", // dup-in-file
    ].join("\n");
    const mapped = defaultMapping(["tag_number", "species", "name", "sex", "breed", "birth_date", "acquisition_date", "status", "pasture", "notes"]);
    const data = parseCsvWithLimits(csv).ok ? (parseCsvWithLimits(csv) as { ok: true; headers: string[]; data: string[][] }).data : [];
    const session = buildReviewSession({
      headers: parseCsvWithLimits(csv).ok ? (parseCsvWithLimits(csv) as { ok: true; headers: string[]; data: string[][] }).headers : [],
      data,
      fingerprint: fingerprintCsv(csv),
      existingTags: new Set(["SV-105", "SV-106"]),
      prevImport: null,
    });
    // First occurrence of a tag maps to its status; the duplicate occurrence
    // always reports dup-in-file.
    const first = (tag: string) => session.rows.find((r) => r.tag_number === tag);
    expect(first("SV-101")?.status).toBe("ready");
    expect(first("SV-102")?.status).toBe("ready");
    expect(session.rows[2].status).toBe("missing"); // blank tag row
    expect(session.rows[2].reason).toContain("Tag");
    expect(first("SV-103")?.status).toBe("ready");
    expect(session.rows.filter((r) => r.status === "dup-in-file").length).toBe(1);
    expect(session.rows.filter((r) => r.status === "dup-in-file")[0].tag_number).toBe("SV-102");
    expect(session.mapping.every((m) => m.field !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeTag + rowToAnimalInput — insert shape mirrors saveAnimal
// ---------------------------------------------------------------------------

describe("normalizeTag / rowToAnimalInput", () => {
  test("normalizeTag trims and collapses interior whitespace; blank → null", () => {
    expect(normalizeTag("  SV - 101  ")).toBe("SV - 101");
    expect(normalizeTag("  ")).toBeNull();
    expect(normalizeTag("\tSV-1\t")).toBe("SV-1");
  });

  test("rowToAnimalInput produces the exact saveAnimal insert shape in lowercase", () => {
    const v = extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow());
    const out = rowToAnimalInput(v);
    expect(out).toEqual({
      species: "cattle",
      name: "Belle",
      tag_number: "SV-101",
      sex: "female",
      breed: "Angus",
      birth_date: "2022-03-14",
      acquisition_date: null,
      status: "active",
      herd_group_id: null,
      pasture: "North Pasture",
      notes: "Replacement heifer",
    });
  });

  test("name defaults to the tag; status defaults to active; blanks are null", () => {
    const out = rowToAnimalInput(
      extractRow(fullMapping as unknown as ReturnType<typeof defaultMapping>, fullRow({ name: "", status: "", sex: "" }))
    );
    expect(out.name).toBe("SV-101");
    expect(out.status).toBe("active");
    expect(out.sex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// csvQuote — review display safety
// ---------------------------------------------------------------------------

describe("csvQuote", () => {
  test("quotes only when needed and doubles inner quotes", () => {
    expect(csvQuote("plain")).toBe("plain");
    expect(csvQuote("a,b")).toBe('"a,b"');
    expect(csvQuote('say "hi"')).toBe('"say ""hi"""');
  });
});