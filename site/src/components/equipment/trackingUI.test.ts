// ============================================================================
// Ranch Manager Pro — Equipment tracking UI helper tests (pure, no DB).
// Mirrors the restock UI-helper contract tests (productBlocker/expenseUI):
// the form-open idempotency key, the money rule (no silent $0 expense), the
// explicit linked-expense choice reaching the payload, submit labels, result
// banners per outcome, and the void confirmation's BOTH-halves wording.
// ============================================================================
import { describe, expect, test } from "bun:test";
import {
  FUEL_COST_HELPER_TEXT,
  FUEL_COST_MISSING_ERROR,
  FUEL_RECORD_ONLY_LABEL,
  FUEL_SUBMIT_RECORD_ONLY,
  FUEL_SUBMIT_WITH_EXPENSE,
  SERVICE_COST_HELPER_TEXT,
  SERVICE_COST_MISSING_ERROR,
  SERVICE_RECORD_ONLY_LABEL,
  SERVICE_SUBMIT_RECORD_ONLY,
  SERVICE_SUBMIT_WITH_EXPENSE,
  TRACKING_ADD_INTENTS,
  buildFuelEditSubmit,
  buildFuelSubmit,
  buildServiceEditSubmit,
  buildServiceSubmit,
  fuelCreatedMessage,
  fuelEditedMessage,
  fuelSubmitLabel,
  fuelVoidConfirmLines,
  fuelVoidedMessage,
  newTrackingRequestId,
  nextFormOpenKey,
  parseCostToCents,
  responseControlsSheet,
  serviceCreatedMessage,
  serviceEditedMessage,
  serviceSubmitLabel,
  serviceVoidConfirmLines,
  serviceVoidedMessage,
  trackingFilterFromSearch,
  validateTrackingMoney,
} from "./trackingUI";

// The 2026-10-26 owner-directed fresh-state fix (pre-acceptance gate 1): a
// genuinely new money entry must get a fresh form + a fresh client_request_id
// WITHOUT a page reload, while retries of the same submission stay deduplicated.
describe("form-open fresh state (fresh id per open, stable id while in flight)", () => {
  test("fresh id per open — every mint differs; an id is never reused across opens", () => {
    const ids = Array.from({ length: 5 }, () => newTrackingRequestId());
    expect(new Set(ids).size).toBe(5);
  });

  test("stable id while in flight — retries of ONE open resend the SAME client_request_id", () => {
    const key = newTrackingRequestId();
    const first = buildFuelSubmit(
      { equipment_id: 0, fuel_date: "2026-10-26", fuel_type: "diesel", gallons: 8, location: null, notes: null },
      { clientRequestId: key, addExpense: true, costCents: 2000, kind: "purchase" }
    );
    const retry = buildFuelSubmit(
      { equipment_id: 0, fuel_date: "2026-10-26", fuel_type: "diesel", gallons: 8, location: null, notes: null },
      { clientRequestId: key, addExpense: true, costCents: 2000, kind: "purchase" }
    );
    expect(first.client_request_id).toBe(key);
    expect(retry.client_request_id).toBe(key);
  });

  test("the NEXT open mints a different id — the settled one is never reused", () => {
    const settled = newTrackingRequestId();
    const next = buildFuelSubmit(
      { equipment_id: 0, fuel_date: "2026-10-26", fuel_type: "diesel", gallons: 5, location: null, notes: null },
      { clientRequestId: newTrackingRequestId(), addExpense: false, costCents: null, kind: "draw" }
    );
    expect(next.client_request_id).not.toBe(settled);
  });

  test("the open counter strictly increases so every open keys a fresh mount", () => {
    const a = nextFormOpenKey(0);
    const b = nextFormOpenKey(a);
    expect(b).toBe(a + 1);
    expect(nextFormOpenKey(b)).toBeGreaterThan(b);
  });

  test("responseControlsSheet — the current open controls the sheet; a settled open's late duplicate does not", () => {
    expect(responseControlsSheet(3, 3)).toBe(true); // response of the open on screen
    expect(responseControlsSheet(2, 3)).toBe(false); // stale tail after a newer open
    expect(responseControlsSheet(4, 3)).toBe(false); // defensive: not the current open
    expect(responseControlsSheet(undefined, 3)).toBe(true); // legacy caller keeps today's behavior
  });
});

describe("tracking client_request_id (idempotency on double-submit)", () => {
  test("generates unique, non-empty keys", () => {
    const a = newTrackingRequestId();
    const b = newTrackingRequestId();
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  test("the SAME form-open key is reused across retries — buildServiceSubmit never regenerates it", () => {
    const key = newTrackingRequestId();
    const base = {
      equipment_id: 1,
      service_date: "2026-10-20",
      service_type: "repair" as const,
      description: null,
      meter_hours: null,
      meter_miles: null,
      status: "done" as const,
      next_due_date: null,
      next_due_hours: null,
      next_due_miles: null,
      vendor: null,
    };
    const first = buildServiceSubmit(base, { clientRequestId: key, addExpense: true, costCents: 18500 });
    const retry = buildServiceSubmit(base, { clientRequestId: key, addExpense: true, costCents: 18500 });
    expect(first.client_request_id).toBe(key);
    expect(retry.client_request_id).toBe(key);
  });

  test("changing form fields between retries still sends the same key", () => {
    const key = newTrackingRequestId();
    const first = buildServiceSubmit(
      { equipment_id: 1, service_date: "2026-10-20", service_type: "repair", description: "a", meter_hours: null, meter_miles: null, status: "done", next_due_date: null, next_due_hours: null, next_due_miles: null, vendor: null },
      { clientRequestId: key, addExpense: true, costCents: 1000 }
    );
    const retry = buildServiceSubmit(
      { equipment_id: 1, service_date: "2026-10-21", service_type: "scheduled", description: "b", meter_hours: null, meter_miles: null, status: "done", next_due_date: null, next_due_hours: null, next_due_miles: null, vendor: "Shop" },
      { clientRequestId: key, addExpense: true, costCents: 1200 }
    );
    expect(first.client_request_id).toBe(key);
    expect(retry.client_request_id).toBe(key);
    expect(retry.cost_cents).toBe(1200);
  });
});

describe("the linked-expense choice reaches the payload (restock rule)", () => {
  test("add-expense keeps the cost and create_expense=true", () => {
    const p = buildFuelSubmit(
      { equipment_id: null, fuel_date: "2026-10-20", fuel_type: "diesel", gallons: 12.5, location: null, notes: null },
      { clientRequestId: "k1", addExpense: true, costCents: 4899, kind: "purchase" }
    );
    expect(p.create_expense).toBe(true);
    expect(p.cost_cents).toBe(4899);
    expect(p.client_request_id).toBe("k1");
    expect(p.record_kind).toBe("purchase");
  });

  test("record-only ALWAYS sends cost_cents null — no expense can be created from that path", () => {
    const fuel = buildFuelSubmit(
      { equipment_id: null, fuel_date: "2026-10-20", fuel_type: "diesel", gallons: 12.5, location: null, notes: null },
      { clientRequestId: "k2", addExpense: false, costCents: 4899, kind: "purchase" }
    );
    expect(fuel.create_expense).toBe(false);
    expect(fuel.cost_cents).toBeNull();
    const service = buildServiceSubmit(
      { equipment_id: 3, service_date: "2026-10-20", service_type: "repair", description: null, meter_hours: null, meter_miles: null, status: "done", next_due_date: null, next_due_hours: null, next_due_miles: null, vendor: null },
      { clientRequestId: "k3", addExpense: false, costCents: 18500 }
    );
    expect(service.create_expense).toBe(false);
    expect(service.cost_cents).toBeNull();
  });

  test("the owner's two-path rule: a DRAW never expenses, even with the cost recorded", () => {
    const draw = buildFuelSubmit(
      { equipment_id: null, fuel_date: "2026-10-20", fuel_type: "diesel", gallons: 40, location: null, notes: null },
      { clientRequestId: "k4", addExpense: true, costCents: 9600, kind: "draw" }
    );
    expect(draw.record_kind).toBe("draw");
    expect(draw.create_expense).toBe(false);
    // The draw's economics cost still rides on the log (reads exclude it from spend).
    expect(draw.cost_cents).toBe(9600);
  });
});

describe("submit labels track the money (owner wording)", () => {
  test("service: cost + expense choice → 'Save service & add expense'", () => {
    expect(serviceSubmitLabel(18500, true)).toBe(SERVICE_SUBMIT_WITH_EXPENSE);
    expect(SERVICE_SUBMIT_WITH_EXPENSE).toBe("Save service & add expense");
  });
  test("service: no cost → 'Save service (record only)'", () => {
    expect(serviceSubmitLabel(null, true)).toBe(SERVICE_SUBMIT_RECORD_ONLY);
    expect(serviceSubmitLabel(18500, false)).toBe(SERVICE_SUBMIT_RECORD_ONLY);
    expect(SERVICE_SUBMIT_RECORD_ONLY).toBe("Save service (record only)");
  });
  test("fuel labels mirror the same rule", () => {
    expect(fuelSubmitLabel(4899, true)).toBe(FUEL_SUBMIT_WITH_EXPENSE);
    expect(fuelSubmitLabel(null, true)).toBe(FUEL_SUBMIT_RECORD_ONLY);
    expect(fuelSubmitLabel(4899, false)).toBe(FUEL_SUBMIT_RECORD_ONLY);
    expect(FUEL_SUBMIT_WITH_EXPENSE).toBe("Save fill-up & add expense");
    expect(FUEL_SUBMIT_RECORD_ONLY).toBe("Save fill-up (record only)");
  });
  test("the two-path kind steers the fuel label (owner rule)", () => {
    expect(fuelSubmitLabel(9600, true, "draw")).toBe("Save fuel usage (draw — no expense)");
    expect(fuelSubmitLabel(null, true, "draw")).toBe("Save fuel usage (draw — no expense)");
    expect(fuelSubmitLabel(4899, true, "purchase")).toBe(FUEL_SUBMIT_WITH_EXPENSE);
  });
});

describe("money validation (a $0 expense is never created silently)", () => {
  test("blank cost in add-expense mode asks the operator", () => {
    expect(validateTrackingMoney("", true, SERVICE_COST_MISSING_ERROR)).toBe(SERVICE_COST_MISSING_ERROR);
    expect(SERVICE_COST_MISSING_ERROR).toBe(
      "Enter the total cost paid, or choose “Service record only — no expense”."
    );
  });
  test("blank cost through the record-only choice is fine", () => {
    expect(validateTrackingMoney("", false, FUEL_COST_MISSING_ERROR)).toBeNull();
  });
  test("a cost present passes", () => {
    expect(validateTrackingMoney("185.00", true, SERVICE_COST_MISSING_ERROR)).toBeNull();
  });
  test("parseCostToCents refuses zero, negatives and junk — null means 'no expense'", () => {
    expect(parseCostToCents("")).toBeNull();
    expect(parseCostToCents("0")).toBeNull();
    expect(parseCostToCents("-5")).toBeNull();
    expect(parseCostToCents("abc")).toBeNull();
    expect(parseCostToCents("185.00")).toBe(18500);
  });
});

describe("result banners per outcome (restockResultMessage mirrored)", () => {
  test("service, expense created, first save", () => {
    expect(serviceCreatedMessage({ ok: true, expense_created: true, duplicate: false })).toEqual({
      kind: "success",
      text: "Service recorded — expense added to Expenses.",
    });
  });
  test("service, record-only, first save", () => {
    expect(serviceCreatedMessage({ ok: true, expense_created: false, duplicate: false })).toEqual({
      kind: "success",
      text: "Service recorded — no expense created (no cost entered).",
    });
  });
  test("duplicate retry reports unchanged state — never a second expense", () => {
    expect(serviceCreatedMessage({ ok: true, expense_created: true, duplicate: true }).text).toBe(
      "Already recorded — nothing changed."
    );
    expect(serviceCreatedMessage({ ok: true, expense_created: false, duplicate: true }).text).toBe(
      "Already recorded — nothing changed."
    );
  });
  test("fuel banners follow the owner's two-path rule", () => {
    expect(fuelCreatedMessage({ ok: true, expense_created: true, duplicate: false, record_kind: "purchase" }).text).toBe(
      "Fuel purchase recorded and expense added."
    );
    expect(fuelCreatedMessage({ ok: true, expense_created: false, duplicate: false, record_kind: "purchase" }).text).toBe(
      "Fuel purchase recorded — no expense created (record only)."
    );
    expect(fuelCreatedMessage({ ok: true, expense_created: true, duplicate: true, record_kind: "purchase" }).text).toBe(
      "Already recorded — nothing changed."
    );
    // A draw: usage recorded, never an expense — even when a cost rides the log.
    expect(fuelCreatedMessage({ ok: true, expense_created: false, duplicate: false, record_kind: "draw" }).text).toBe(
      "Fuel usage recorded — no expense (drawn from an already-purchased tank)."
    );
    expect(fuelCreatedMessage({ ok: true, expense_created: false, duplicate: true, record_kind: "draw" }).text).toBe(
      "Already recorded — nothing changed."
    );
  });
  test("server refusal errors are quoted verbatim", () => {
    const err = "That equipment doesn't exist in this ranch.";
    expect(serviceCreatedMessage({ ok: false, error: err })).toEqual({ kind: "error", text: err });
    expect(fuelCreatedMessage({ ok: false, error: err })).toEqual({ kind: "error", text: err });
  });
});

describe("edit + void banners (both halves, restock precedent)", () => {
  test("edit: cost kept vs cost removed", () => {
    expect(serviceEditedMessage(true)).toBe("Service record and linked expense updated.");
    expect(serviceEditedMessage(false)).toBe("Service record updated — no linked expense.");
    expect(fuelEditedMessage(true)).toBe("Fuel purchase and linked expense updated.");
    expect(fuelEditedMessage(false)).toBe("Fuel purchase updated — no linked expense.");
    expect(fuelEditedMessage(false, "draw")).toBe("Fuel usage updated — a draw never creates an expense.");
  });
  test("void: removed-with-expense vs nothing-linked", () => {
    expect(serviceVoidedMessage(true)).toBe("Service record voided — the linked expense was removed.");
    expect(serviceVoidedMessage(false)).toBe("Service record voided — there was no linked expense.");
    expect(fuelVoidedMessage(true)).toBe("Fuel purchase voided — the linked expense was removed.");
    expect(fuelVoidedMessage(false)).toBe("Fuel purchase voided — there was no linked expense.");
    expect(fuelVoidedMessage(false, "draw")).toBe("Fuel usage record voided — a draw has no expense to remove.");
  });
  test("void CONFIRM states both halves when an expense is linked", () => {
    const lines = serviceVoidConfirmLines(true, 18500);
    expect(lines[0]).toBe("This removes the service record and its linked expense.");
    expect(lines[1]).toContain("$185.00");
    const fuelLines = fuelVoidConfirmLines(true, 4899);
    expect(fuelLines[0]).toBe("This removes the fuel purchase record and its linked expense.");
    expect(fuelLines[1]).toContain("$48.99");
  });
  test("void CONFIRM is honest when there is no linked expense", () => {
    expect(serviceVoidConfirmLines(false, null)).toEqual([
      "This removes the service record.",
      "There is no linked expense to remove.",
    ]);
    expect(fuelVoidConfirmLines(false, null)).toEqual([
      "This removes the fuel purchase record.",
      "There is no linked expense to remove.",
    ]);
  });
  test("void CONFIRM for a draw: the usage record goes, no expense existed", () => {
    expect(fuelVoidConfirmLines(false, null, "draw")).toEqual([
      "This removes the fuel usage record.",
      "A bulk-tank draw never created an expense — there is nothing to remove.",
    ]);
  });
});

describe("helper texts and choice labels (the form contract)", () => {
  test("cost helpers promise the ledger, per record kind", () => {
    expect(SERVICE_COST_HELPER_TEXT).toBe("Saving this service will add this amount to Expenses.");
    expect(FUEL_COST_HELPER_TEXT).toBe("Saving this fill-up will add this amount to Expenses.");
  });
  test("the record-only choices are named per record kind", () => {
    expect(SERVICE_RECORD_ONLY_LABEL).toBe("Service record only — no expense");
    expect(FUEL_RECORD_ONLY_LABEL).toBe("Fill-up record only — no expense");
  });
});

describe("D7 — ?add=service / ?add=fuel quick-add intents", () => {
  test("recognizes both equipment intents", () => {
    expect(TRACKING_ADD_INTENTS).toEqual(["service", "fuel"]);
    expect(trackingFilterFromSearch({ add: "service" })).toEqual({ add: "service" });
    expect(trackingFilterFromSearch({ add: "fuel" })).toEqual({ add: "fuel" });
  });
  test("ignores intents this route does not own", () => {
    expect(trackingFilterFromSearch({ add: "expense" })).toEqual({ add: undefined });
    expect(trackingFilterFromSearch({})).toEqual({ add: undefined });
    expect(trackingFilterFromSearch({ add: 5 })).toEqual({ add: undefined });
  });
});

describe("edit payload builders", () => {
  test("fuel edit carries the cost or null", () => {
    const withCost = buildFuelEditSubmit(
      { id: 9, fuel_date: "2026-10-20", fuel_type: "diesel", gallons: 10, location: null, notes: null, meter_hours: null, meter_miles: null },
      9620
    );
    expect(withCost.cost_cents).toBe(9620);
    expect(withCost.id).toBe(9);
    const withoutCost = buildFuelEditSubmit(
      { id: 9, fuel_date: "2026-10-20", fuel_type: "diesel", gallons: 10, location: null, notes: null, meter_hours: null, meter_miles: null },
      null
    );
    expect(withoutCost.cost_cents).toBeNull();
  });
  test("service edit carries the cost or null", () => {
    const withCost = buildServiceEditSubmit(
      { id: 4, service_date: "2026-10-20", service_type: "repair", description: null, vendor: null, meter_hours: null, meter_miles: null, next_due_date: null, next_due_hours: null, next_due_miles: null },
      18500
    );
    expect(withCost.cost_cents).toBe(18500);
  });
});
