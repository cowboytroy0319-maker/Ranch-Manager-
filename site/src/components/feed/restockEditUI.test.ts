// ============================================================================
// Unit tests for the restock edit/void UI-path helpers (no DB needed):
//   - edit cost field parsing (blank/zero/garbage → null = no linked expense)
//   - edit + void outcome messages never overclaim the ledger
// Core coverage (edit-updates-no-dupe, void-reverses) lives in
// src/server/productBlocker.test.ts against the local scratch Postgres.
// ============================================================================
import { describe, expect, test } from "bun:test";
import {
  editRestockSavedMessage,
  parseEditCostDollars,
  voidRestockMessage,
} from "./restockUI";

describe("edit-restock cost parsing", () => {
  test("dollars convert to cents", () => {
    expect(parseEditCostDollars("480.00")).toBe(48000);
    expect(parseEditCostDollars(" 12.5 ")).toBe(1250);
  });
  test("blank / zero / negative / garbage → null (no linked expense)", () => {
    expect(parseEditCostDollars("") === null).toBe(true);
    expect(parseEditCostDollars("   ") === null).toBe(true);
    expect(parseEditCostDollars("0") === null).toBe(true);
    expect(parseEditCostDollars("0.00") === null).toBe(true);
    expect(parseEditCostDollars("-5") === null).toBe(true);
    expect(parseEditCostDollars("abc") === null).toBe(true);
  });
});

describe("edit/void outcome messages", () => {
  test("edit claims a linked expense only when one exists", () => {
    expect(editRestockSavedMessage(true, 48000)).toContain("linked expense");
    expect(editRestockSavedMessage(false, 48000)).toContain("linked expense");
    expect(editRestockSavedMessage(false, null)).toContain("no linked expense");
  });
  test("void names the expense removal only when it happened", () => {
    expect(voidRestockMessage(true)).toContain("linked expense removed");
    expect(voidRestockMessage(false)).toBe("Restock voided — inventory reversed.");
  });
});
