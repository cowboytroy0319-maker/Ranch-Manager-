// ============================================================================
// LEGACY EXPENSE CATEGORIES IN THE UI — label fallback, unique keys, edit form
// ============================================================================
//
//   bun test src/server/expensesLegacyCategory.test.ts
//
// THE DEFECT THIS PINS (found by the independent verifier, item 3 of the owner's
// follow-up list)
//   A row holding one of the six LEGACY category values — `feed`, `vet_health`,
//   `maintenance`, `insurance`, `fuel`, `other` (0007_expenses.sql, i.e. what
//   production held before 0018) — used to render:
//     * `CATEGORY_LABEL['feed'] === undefined` → a BLANK badge and an
//       `undefined` React key in the breakdown list, and
//     * a blank category in the edit sheet, with the save refused by
//       `parseExpenseInput` ("Pick a category for this expense.").
//
// WHAT IS ASSERTED
//   1. Every legacy value (and NULL / empty / unknown) renders a real, non-blank
//      label — and a legacy value shows the SAME text as its canonical twin.
//   2. Every category-driven list has a non-undefined, unique key per item.
//   3. The edit form round-trips: the sheet opens on a legacy row's canonical
//      equivalent and the value that reaches the write path (the real
//      `parseExpenseInput`) is canonical — never the legacy spelling, never
//      refused.
// ============================================================================
import { describe, expect, test } from "bun:test";
import { parseExpenseInput } from "~/server/expenses";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_OPTIONS,
  LEGACY_CATEGORY_TO_CANONICAL,
  LEGACY_EXPENSE_CATEGORIES,
  canonicalExpenseCategory,
  categoryDisplayRows,
  categoryLabel,
  categoryTotals,
  expenseFormCategory,
  type ExpenseCategory,
  type LegacyExpenseCategory,
} from "~/types/expenses";

const LEGACY: readonly LegacyExpenseCategory[] = LEGACY_EXPENSE_CATEGORIES;

describe("every value the database can hold renders a readable label", () => {
  for (const legacy of LEGACY) {
    test(`legacy ${legacy} has a real label, identical to its canonical twin`, () => {
      const canonical = LEGACY_CATEGORY_TO_CANONICAL[legacy];
      const label = categoryLabel(legacy);
      expect(typeof label).toBe("string");
      expect(label.length > 0).toBe(true);
      expect(label).not.toBe("undefined");
      expect(label).toBe(categoryLabel(canonical));
      expect(label).toBe(CATEGORY_LABEL[legacy]);
    });
  }

  for (const category of EXPENSE_CATEGORIES) {
    test(`canonical ${category} is labelled`, () => {
      expect(categoryLabel(category)).toBe(CATEGORY_LABEL[category]);
    });
  }

  test("NULL / empty / non-string / unknown values degrade to something readable", () => {
    for (const value of [null, undefined, "", "   ", 42, {}, "misc", "some_odd_value", "Feed"]) {
      const label = categoryLabel(value);
      expect(typeof label).toBe("string");
      expect(label.trim().length > 0).toBe(true);
      expect(label).not.toBe("undefined");
      expect(label).not.toBe("null");
    }
    expect(categoryLabel(null)).toBe("Uncategorized");
    expect(categoryLabel("misc")).toBe("Misc");
    expect(categoryLabel("some_odd_value")).toBe("Some odd value");
  });

  test("canonicalization maps exactly the six legacy values and nothing else", () => {
    for (const legacy of LEGACY) {
      expect(canonicalExpenseCategory(legacy)).toBe(LEGACY_CATEGORY_TO_CANONICAL[legacy]);
    }
    for (const canonical of EXPENSE_CATEGORIES) {
      expect(canonicalExpenseCategory(canonical)).toBe(canonical);
    }
    expect(canonicalExpenseCategory("random_stuff")).toBeNull();
    expect(canonicalExpenseCategory(null)).toBeNull();
    expect(canonicalExpenseCategory(7)).toBeNull();
  });
});

describe("category-driven lists: no undefined names, no duplicate keys", () => {
  test("a legacy-only breakdown produces keyed rows with real names", () => {
    const rows = categoryDisplayRows([
      { category: "feed", amount_cents: 187000, entries: 3 },
      { category: "vet_health", amount_cents: 54200, entries: 3 },
      { category: "maintenance", amount_cents: 141500, entries: 3 },
      { category: "insurance", amount_cents: 300000, entries: 2 },
      { category: "other", amount_cents: 6000, entries: 1 },
    ]);
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.key.length > 0).toBe(true);
      expect(row.name.length > 0).toBe(true);
      expect(row.name).not.toBe("undefined");
    }
    expect(rows.find((r) => r.key === "cat:hay_feed")?.name).toBe("Hay & feed");
  });

  test("a legacy row and its canonical twin merge into ONE row (the duplicate-key case)", () => {
    const rows = categoryDisplayRows([
      { category: "feed", amount_cents: 100000, entries: 2 },
      { category: "hay_feed", amount_cents: 50000, entries: 1 },
      { category: "misc", amount_cents: 1000, entries: 1 },
    ]);
    expect(rows.length).toBe(2);
    const hay = rows.find((r) => r.key === "cat:hay_feed");
    expect(hay?.name).toBe("Hay & feed");
    expect(hay?.amount_cents).toBe(150000);
    expect(hay?.entries).toBe(3);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => !String(r.name).includes("undefined"))).toBe(true);
  });

  test("a list with many legacy + canonical twins still yields unique keys every time", () => {
    const rows = categoryDisplayRows([
      ...LEGACY.map((c) => ({ category: c as string, amount_cents: 10, entries: 1 })),
      ...EXPENSE_CATEGORIES.map((c) => ({ category: c as string, amount_cents: 10, entries: 1 })),
      { category: null, amount_cents: 5, entries: 1 },
    ]);
    const keys = rows.map((r) => r.key);
    expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // 12 canonical keys + 1 for the NULL row (legacy spellings merge into them).
    expect(rows.length).toBe(13);
  });

  test("the <select>/filter option list is unique with non-empty labels", () => {
    expect(EXPENSE_CATEGORY_OPTIONS.length).toBe(EXPENSE_CATEGORIES.length);
    expect(new Set(EXPENSE_CATEGORY_OPTIONS.map((o) => o.value)).size).toBe(
      EXPENSE_CATEGORY_OPTIONS.length
    );
    for (const option of EXPENSE_CATEGORY_OPTIONS) {
      expect(option.label.trim().length > 0).toBe(true);
    }
  });

  test("a legacy spelling counts toward its canonical category's headline total", () => {
    const byCategory = [
      { category: "feed", amount_cents: 187000, entries: 3 },
      { category: "hay_feed", amount_cents: 13000, entries: 1 },
    ];
    const hay = categoryTotals(byCategory, "hay_feed");
    expect(hay.amount_cents).toBe(200000);
    expect(hay.entries).toBe(4);
    expect(categoryTotals(byCategory, "livestock").amount_cents).toBe(0);
  });
});

describe("the edit form round-trips a legacy category to a canonical value", () => {
  for (const legacy of LEGACY) {
    test(`editing a ${legacy} row opens on and saves the canonical value`, () => {
      const canonical = LEGACY_CATEGORY_TO_CANONICAL[legacy];

      // What the sheet's category <select> is initialised to.
      const formCategory = expenseFormCategory(legacy);
      expect(formCategory).toBe(canonical);
      // ...and it is a real option in the list, never a blank/absent value.
      expect(EXPENSE_CATEGORY_OPTIONS.some((o) => o.value === formCategory)).toBe(true);

      // What the save actually writes: the real validator the server fn runs.
      const parsed = parseExpenseInput({
        id: 1,
        expense_date: "2026-08-05",
        category: formCategory,
        amount_cents: 124000,
        vendor: "Chappell Feed & Seed",
      });
      expect(parsed.category).toBe(canonical);
      expect((EXPENSE_CATEGORIES as readonly string[]).includes(parsed.category)).toBe(true);
    });
  }

  test("a canonical value is left exactly as stored", () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(expenseFormCategory(category)).toBe(category);
    }
  });

  test("an unrecognised stored value is shown as-is rather than silently blanked", () => {
    // The sheet must not hide what is stored. It is kept (and labelled), and the
    // write path still refuses a value the database cannot take — with the same
    // plain-language error, never a silent rewrite.
    expect(expenseFormCategory("misc")).toBe("misc");
    expect(categoryLabel("misc")).toBe("Misc");
    expect(() =>
      parseExpenseInput({
        expense_date: "2026-08-05",
        category: "misc",
        amount_cents: 100,
        vendor: "Odd",
      })
    ).toThrow("Pick a category for this expense.");
  });

  test("a missing/empty stored category still yields a usable default", () => {
    expect(expenseFormCategory(undefined)).toBe("hay_feed");
    expect(expenseFormCategory(null)).toBe("hay_feed");
    expect(expenseFormCategory("")).toBe("hay_feed");
    expect(expenseFormCategory("   ")).toBe("hay_feed");
  });

  test("the canonical write is one of the values the migration's CHECK allows", () => {
    // 0018's CHECK is exactly EXPENSE_CATEGORIES — a save can only succeed when
    // the form hands the server one of them.
    for (const legacy of LEGACY) {
      const written = parseExpenseInput({
        expense_date: "2026-08-05",
        category: expenseFormCategory(legacy),
        amount_cents: 100,
        vendor: "V",
      }).category as ExpenseCategory;
      expect((EXPENSE_CATEGORIES as readonly string[]).includes(written)).toBe(true);
    }
  });
});
