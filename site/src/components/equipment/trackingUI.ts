// ============================================================================
// Ranch Manager Pro — Equipment tracking UI helpers (pure, unit-testable).
// The equipment twin of feed/restockUI.ts: the idempotency key rule (ONE
// client_request_id per form-open, never regenerated on retry), the explicit
// linked-expense choice, the money rule (a $0 expense is never created
// silently), and the result banners. These strings are the Phase-2 UI
// contract the browser E2E asserts — change them only with the owner.
// ============================================================================
import type { FuelEditInput, MaintEditInput, MaintLogInput, FuelLogInput } from "~/server/equipment";
import { fmtDollars } from "~/types/equipment";

export function newTrackingRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Very old Safari fallback — still unique per call, just longer.
  return `eq-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// THE OWNER'S FORM CONTRACT (audit Phase 2 part 2). Do not reword.
// ---------------------------------------------------------------------------

/** Exact helper text under the cost field. */
export const SERVICE_COST_HELPER_TEXT = "Saving this service will add this amount to Expenses.";
export const FUEL_COST_HELPER_TEXT = "Saving this fill-up will add this amount to Expenses.";

/** The two explicit choices about the linked expense. */
export const TRACKING_ADD_EXPENSE_LABEL = "Add linked expense";
export const SERVICE_RECORD_ONLY_LABEL = "Service record only — no expense";
export const FUEL_RECORD_ONLY_LABEL = "Fill-up record only — no expense";

/** Submit labels track the money: the save WILL or WILL NOT write a ledger row. */
export const SERVICE_SUBMIT_WITH_EXPENSE = "Save service & add expense";
export const SERVICE_SUBMIT_RECORD_ONLY = "Save service (record only)";
export const FUEL_SUBMIT_WITH_EXPENSE = "Save fill-up & add expense";
export const FUEL_SUBMIT_RECORD_ONLY = "Save fill-up (record only)";

/** Shown when the operator left the cost blank but is still in "Add linked
 *  expense" mode — the app never invents a $0 expense, it asks. */
export const SERVICE_COST_MISSING_ERROR =
  "Enter the total cost paid, or choose “Service record only — no expense”.";
export const FUEL_COST_MISSING_ERROR =
  "Enter the total cost paid, or choose “Fill-up record only — no expense”.";

/** The Quick-Add intents the /equipment route honors (?add=service, ?add=fuel). */
export const TRACKING_ADD_INTENTS = ["service", "fuel"] as const;
export type TrackingAddIntent = (typeof TRACKING_ADD_INTENTS)[number];

/** Route search shape for /equipment (validated by validateSearch): only the
 *  add intent is kept, so a stray query can't reach the loader. */
export type TrackingSearch = { add?: string };

export function trackingFilterFromSearch(search: Record<string, unknown>): TrackingSearch {
  return {
    add:
      typeof search.add === "string" && (TRACKING_ADD_INTENTS as readonly string[]).includes(search.add)
        ? search.add
        : undefined,
  };
}

/** Dollars text → integer cents. Blank is null ("no expense"); anything
 *  unparseable or ≤ 0 is null too — never NaN, never a silent 0. */
export function parseCostToCents(input: string): number | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** The submit label tracks the money: a cost present (and the expense choice
 *  on) → "Save … & add expense"; otherwise → record only. */
export function serviceSubmitLabel(costCents: number | null, addExpense: boolean): string {
  return costCents !== null && addExpense ? SERVICE_SUBMIT_WITH_EXPENSE : SERVICE_SUBMIT_RECORD_ONLY;
}
export function fuelSubmitLabel(costCents: number | null, addExpense: boolean): string {
  return costCents !== null && addExpense ? FUEL_SUBMIT_WITH_EXPENSE : FUEL_SUBMIT_RECORD_ONLY;
}

/** Client-side money validation (the restock rule): a blank cost is fine — but
 *  only through the explicit record-only choice. Returns null when savable. */
export function validateTrackingMoney(costDollars: string, addExpense: boolean, recordOnlyError: string): string | null {
  if (addExpense && parseCostToCents(costDollars) === null) return recordOnlyError;
  return null;
}

/** Apply the linked-expense choice to a write payload: "record only" always
 *  sends cost_cents null and create_expense false, so no expense row can be
 *  created from that path (the restock rule, FeedModals.tsx 618–620). */
export function applyExpenseChoice<T extends { create_expense: boolean; cost_cents: number | null }>(
  payload: T,
  addExpense: boolean,
  costCents: number | null
): T {
  return { ...payload, create_expense: addExpense, cost_cents: addExpense ? costCents : null };
}

/** Build the service submit payload from form state + the form-open key.
 *  Pure so the "same key on retry" and "record-only sends no cost" invariants
 *  are assertable without a DOM. */
export function buildServiceSubmit(
  base: Omit<MaintLogInput, "client_request_id" | "create_expense" | "cost_cents">,
  opts: { clientRequestId: string; addExpense: boolean; costCents: number | null }
): MaintLogInput {
  return applyExpenseChoice(
    { ...base, client_request_id: opts.clientRequestId, create_expense: opts.addExpense, cost_cents: opts.costCents },
    opts.addExpense,
    opts.costCents
  );
}

/** Build the fuel submit payload (same contract as buildServiceSubmit). */
export function buildFuelSubmit(
  base: Omit<FuelLogInput, "client_request_id" | "create_expense" | "cost_cents">,
  opts: { clientRequestId: string; addExpense: boolean; costCents: number | null }
): FuelLogInput {
  return applyExpenseChoice(
    { ...base, client_request_id: opts.clientRequestId, create_expense: opts.addExpense, cost_cents: opts.costCents },
    opts.addExpense,
    opts.costCents
  );
}

// ---------------------------------------------------------------------------
// Result banners — which thing actually happened, never an overclaim.
// ---------------------------------------------------------------------------

export type TrackingWriteResult =
  | { ok: true; expense_created: boolean; duplicate: boolean }
  | { ok: false; error: string };

export type TrackingResultMessage = { kind: "success" | "error"; text: string };

/** A created service record's banner. Server refusal errors are quoted
 *  verbatim — the operator sees the server's own words. */
export function serviceCreatedMessage(res: TrackingWriteResult): TrackingResultMessage {
  if (!res.ok) return { kind: "error", text: res.error };
  if (res.expense_created) {
    return {
      kind: "success",
      text: res.duplicate ? "Already recorded — nothing changed." : "Service recorded — expense added to Expenses.",
    };
  }
  return {
    kind: "success",
    text: res.duplicate
      ? "Already recorded — nothing changed."
      : "Service recorded — no expense created (no cost entered).",
  };
}

/** A created fuel fill-up's banner. */
export function fuelCreatedMessage(res: TrackingWriteResult): TrackingResultMessage {
  if (!res.ok) return { kind: "error", text: res.error };
  if (res.expense_created) {
    return {
      kind: "success",
      text: res.duplicate ? "Already recorded — nothing changed." : "Fill-up recorded — expense added to Expenses.",
    };
  }
  return {
    kind: "success",
    text: res.duplicate
      ? "Already recorded — nothing changed."
      : "Fill-up recorded — no expense created (no cost entered).",
  };
}

/** Edit banners (the restock precedent: cost kept vs cost removed). */
export function serviceEditedMessage(expenseLinked: boolean): string {
  return expenseLinked ? "Service record and linked expense updated." : "Service record updated — no linked expense.";
}
export function fuelEditedMessage(expenseLinked: boolean): string {
  return expenseLinked ? "Fill-up and linked expense updated." : "Fill-up updated — no linked expense.";
}

/** Void banners state BOTH halves (restock precedent). */
export function serviceVoidedMessage(linkedExpenseRemoved: boolean): string {
  return linkedExpenseRemoved
    ? "Service record voided — the linked expense was removed."
    : "Service record voided — there was no linked expense.";
}
export function fuelVoidedMessage(linkedExpenseRemoved: boolean): string {
  return linkedExpenseRemoved
    ? "Fill-up voided — the linked expense was removed."
    : "Fill-up voided — there was no linked expense.";
}

/** The void CONFIRMATION lines. Must state both halves: the record goes AND
 *  its linked expense goes (or, honestly, that there is nothing linked). The
 *  hasLinked flag comes from the loader's link info, so a legacy record with
 *  no ledger row never overclaims. */
export function serviceVoidConfirmLines(hasLinkedExpense: boolean, amountCents: number | null): string[] {
  if (!hasLinkedExpense) return ["This removes the service record.", "There is no linked expense to remove."];
  return [
    "This removes the service record and its linked expense.",
    amountCents != null ? `The linked ${fmtDollars(amountCents)} expense is removed from Expenses.` : "The linked expense is removed from Expenses.",
  ];
}
export function fuelVoidConfirmLines(hasLinkedExpense: boolean, amountCents: number | null): string[] {
  if (!hasLinkedExpense) return ["This removes the fill-up record.", "There is no linked expense to remove."];
  return [
    "This removes the fill-up record and its linked expense.",
    amountCents != null ? `The linked ${fmtDollars(amountCents)} expense is removed from Expenses.` : "The linked expense is removed from Expenses.",
  ];
}

/** Build the fuel-edit payload from the edit modal's fields (pure). */
export function buildFuelEditSubmit(
  base: Omit<FuelEditInput, "cost_cents">,
  costCents: number | null
): FuelEditInput {
  return { ...base, cost_cents: costCents };
}

/** Build the service-edit payload from the edit modal's fields (pure). */
export function buildServiceEditSubmit(
  base: Omit<MaintEditInput, "cost_cents">,
  costCents: number | null
): MaintEditInput {
  return { ...base, cost_cents: costCents };
}
