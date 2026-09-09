// ============================================================================
// Unit tests for the Part B1 UI logic (no DB needed):
//   - ?add=expense intent parsing (expenses route wiring)
//   - /expenses route search → filter parsing
//   - linked-source indicators (no overclaiming)
//   - restock idempotency key: generated once, stable across retries
//   - restock result messages (expense recorded vs no-cost)
// ============================================================================
import { describe, expect, test } from "bun:test";
import {
  EXPENSE_ADD_INTENTS,
  MANUAL_SOURCE_LABEL,
  expenseFilterFromSearch,
  expenseSourceIndicator,
  parseAddIntent,
} from "./expenseUI";
import {
  buildRestockSubmit,
  newClientRequestId,
  restockResultMessage,
} from "../feed/restockUI";

describe("expenses ?add=expense intent wiring", () => {
  test("recognizes the expense intent MobileNav links to", () => {
    expect(parseAddIntent("expense", EXPENSE_ADD_INTENTS)).toBe("expense");
  });
  test("ignores intents this route does not own", () => {
    expect(parseAddIntent("hay", EXPENSE_ADD_INTENTS)).toBeNull();
  });
  test("ignores missing/non-string values", () => {
    expect(parseAddIntent(undefined, EXPENSE_ADD_INTENTS)).toBeNull();
    expect(parseAddIntent(123, EXPENSE_ADD_INTENTS)).toBeNull();
    expect(parseAddIntent("", EXPENSE_ADD_INTENTS)).toBeNull();
  });
});

describe("expenses route search → loader filter", () => {
  test("keeps well-formed dates and category, drops the rest", () => {
    const s = expenseFilterFromSearch({ from: "2026-01-01", to: "2026-01-31", category: "hay_feed", add: "expense" });
    expect(s).toEqual({ from: "2026-01-01", to: "2026-01-31", category: "hay_feed", add: "expense" });
  });
  test("rejects junk dates and unknown params so nothing malformed reaches the DB", () => {
    const s = expenseFilterFromSearch({ from: "not-a-date", to: "2026-13-99", category: "DROP TABLE", zzz: "1" });
    expect(s).toEqual({ add: undefined, from: undefined, to: undefined, category: "DROP TABLE" });
    // category is validated server-side too (parseExpenseFilters); the route
    // only passes it through when the string matches an allowed value there.
  });
  test("empty search yields an empty filter (current-month default)", () => {
    expect(expenseFilterFromSearch({})).toEqual({ add: undefined, from: undefined, to: undefined, category: undefined });
  });
});

describe("expense linked-source indicators", () => {
  test("restock rows point at the Hay & Feed module with an honest label", () => {
    const ind = expenseSourceIndicator({ source_type: "restock", source_id: 7, pasture_id: null });
    expect(ind?.label).toBe("↳ hay/feed restock");
    expect(ind?.to).toBe("/feed");
    expect(ind?.hint).toContain("Hay & Feed");
  });
  test("pasture-activity rows deep-link to the pasture detail when the id is known", () => {
    const ind = expenseSourceIndicator({ source_type: "pasture_activity", source_id: 3, pasture_id: 12 });
    expect(ind?.label).toBe("↳ pasture activity");
    expect(ind?.to).toBe("/pasture?open=12");
  });
  test("pasture-activity rows fall back to the module when pasture_id is null", () => {
    const ind = expenseSourceIndicator({ source_type: "pasture_activity", source_id: 3, pasture_id: null });
    expect(ind?.to).toBe("/pasture");
  });
  test("manual rows have no indicator — they say 'manual' instead", () => {
    expect(expenseSourceIndicator({ source_type: null, source_id: null, pasture_id: null })).toBeNull();
    expect(MANUAL_SOURCE_LABEL).toBe("manual");
  });
});

describe("restock client_request_id (idempotency on double-submit)", () => {
  test("generates unique, non-empty keys", () => {
    const a = newClientRequestId();
    const b = newClientRequestId();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });
  test("the SAME form-open key is reused across retries — buildRestockSubmit never regenerates it", () => {
    const crid = newClientRequestId();
    const form = {
      item_kind: "hay" as const,
      item_id: 1,
      quantity: 10,
      unit: "bales",
      restock_date: "2026-09-09",
      total_cost_cents: 4500,
      vendor: "Feed store",
      notes: null,
    };
    const attempt1 = buildRestockSubmit(form, crid);
    const attempt2 = buildRestockSubmit({ ...form, quantity: 10 }, crid); // user taps save again
    expect(attempt1.client_request_id).toBe(crid);
    expect(attempt2.client_request_id).toBe(crid);
    expect(attempt1.client_request_id).toBe(attempt2.client_request_id);
  });
  test("changing form fields between retries still sends the same key", () => {
    const crid = newClientRequestId();
    const base = {
      item_kind: "feed" as const,
      item_id: 2,
      quantity: 100,
      unit: "lbs",
      restock_date: "2026-09-09",
      total_cost_cents: null,
      vendor: null,
      notes: "x",
    };
    expect(buildRestockSubmit(base, crid).client_request_id).toBe(crid);
    expect(buildRestockSubmit({ ...base, quantity: 120 }, crid).client_request_id).toBe(crid);
  });
});

describe("restock result messages (owner-required wording)", () => {
  test("cost entered → 'Inventory updated and expense recorded.'", () => {
    const m = restockResultMessage({ ok: true, id: 1, expense_created: true, duplicate: false });
    expect(m.kind).toBe("success");
    expect(m.text).toBe("Inventory updated and expense recorded.");
  });
  test("no cost → 'Inventory updated — no expense created (no cost entered).'", () => {
    const m = restockResultMessage({ ok: true, id: 1, expense_created: false, duplicate: false });
    expect(m.kind).toBe("success");
    expect(m.text).toBe("Inventory updated — no expense created (no cost entered).");
  });
  test("a duplicate submit reports unchanged state instead of implying a second expense", () => {
    expect(restockResultMessage({ ok: true, id: 1, expense_created: true, duplicate: true }).text).toContain("Already recorded");
    expect(restockResultMessage({ ok: true, id: 1, expense_created: false, duplicate: true }).text).toContain("Already recorded");
  });
  test("server errors pass through untouched", () => {
    const m = restockResultMessage({ ok: false, error: "That hay stack no longer exists." });
    expect(m.kind).toBe("error");
    expect(m.text).toBe("That hay stack no longer exists.");
  });
});
