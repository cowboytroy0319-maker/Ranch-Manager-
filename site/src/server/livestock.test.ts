// ============================================================================
// Ranch Manager Pro — Livestock server pure-logic unit tests (bun test)
// Exercises the validators + duplicate-tag guard without touching a database.
//   bun test src/server/livestock.test.ts
// ============================================================================
import { describe, expect, test } from "bun:test";
import { findTagCollision, parseAnimalInput } from "./livestock";
import { ANIMAL_STATUSES } from "~/types/livestock";

describe("parseAnimalInput — tag required, name optional", () => {
  test("throws when tag_number is missing", () => {
    expect(() => parseAnimalInput({ species: "cattle", name: "Belle" })).toThrow(
      "Tag/animal ID is required."
    );
  });

  test("throws when tag_number is blank/whitespace only", () => {
    expect(() => parseAnimalInput({ species: "cattle", name: "Belle", tag_number: "  " })).toThrow(
      "Tag/animal ID is required."
    );
  });

  test("name is optional and defaults to the tag for display", () => {
    const out = parseAnimalInput({ species: "cattle", tag_number: "SV-101" });
    expect(out.name).toBe("SV-101");
    expect(out.tag_number).toBe("SV-101");
  });

  test("keeps an explicit name when provided", () => {
    const out = parseAnimalInput({ species: "cattle", name: "Belle", tag_number: "SV-101" });
    expect(out.name).toBe("Belle");
  });

  test("parses acquisition_date when provided and null when absent", () => {
    const withDate = parseAnimalInput({
      species: "cattle",
      name: "Belle",
      tag_number: "SV-101",
      acquisition_date: "2024-03-01",
    });
    expect(withDate.acquisition_date).toBe("2024-03-01");
    const withoutDate = parseAnimalInput({ species: "cattle", tag_number: "SV-101" });
    expect(withoutDate.acquisition_date).toBeNull();
  });
});

describe("findTagCollision — duplicate-tag detection", () => {
  const rows = [
    { id: 1, tag_number: "SV-101" },
    { id: 2, tag_number: "SV-102" },
    { id: 3, tag_number: null },
  ];

  test("same tag on a different id is a collision", () => {
    expect(findTagCollision(rows, "SV-101", 7)).toBe(true);
  });

  test("same tag on the animal's own id is not a collision (edit path)", () => {
    expect(findTagCollision(rows, "SV-101", 1)).toBe(false);
  });

  test("trimming: padded input still matches", () => {
    expect(findTagCollision(rows, "  SV-101  ", 7)).toBe(true);
  });

  test("blank tag never collides (legacy NULL/empty rows stay allowed)", () => {
    expect(findTagCollision(rows, "  ", 7)).toBe(false);
    expect(findTagCollision(rows, "", 7)).toBe(false);
  });

  test("no match returns false", () => {
    expect(findTagCollision(rows, "G-201", 7)).toBe(false);
  });
});

describe("ANIMAL_STATUSES allow-list", () => {
  test("includes culled and archived alongside the original statuses", () => {
    expect(ANIMAL_STATUSES).toContain("active");
    expect(ANIMAL_STATUSES).toContain("pending");
    expect(ANIMAL_STATUSES).toContain("sold");
    expect(ANIMAL_STATUSES).toContain("deceased");
    expect(ANIMAL_STATUSES).toContain("culled");
    expect(ANIMAL_STATUSES).toContain("archived");
  });
});