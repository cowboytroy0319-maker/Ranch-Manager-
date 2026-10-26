// ============================================================================
// Ranch Manager Pro — Equipment tracking UI helpers (pure, unit-testable).
// The equipment twin of feed/restockUI.ts: the idempotency key rule (ONE
// client_request_id per form-open, never regenerated on retry), the explicit
// linked-expense choice, the money rule (a $0 expense is never created
// silently), and the result banners. These strings are the Phase-2 UI
// contract the browser E2E asserts — change them only with the owner.
// ============================================================================
import type { FuelEditInput, MaintEditInput, MaintLogInput, FuelLogInput, FuelRecordKind } from "~/server/equipment";
import { fmtDollars } from "~/types/equipment";

export function newTrackingRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Very old Safari fallback — still unique per call, just longer.
  return `eq-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// THE FORM-OPEN CONTRACT (the 2026-10-26 owner-directed fresh-state fix).
// One form-open = one mount = ONE client_request_id:
//   • the PARENT bumps an open counter on EVERY open of the money modal (the
//     sheet button and the ?add= deep link) and keys the modal with it — each
//     open therefore remounts the modal and its lazy useState initializers
//     mint a FRESH form and a FRESH client_request_id, even when the previous
//     open's duplicate responses are still settling;
//   • inside one open, every retry re-sends the SAME id (the double-tap
//     dedupe — QA3B evidence) because the id is plain component state;
//   • a settled open's LATE duplicate response may still show the honest
//     banner and refresh the list, but it must never close or overwrite a
//     NEWER open's fresh form — the parent checks responseControlsSheet.
// Pure so both rules are assertable without a DOM.
// ---------------------------------------------------------------------------

/** The next modal-open counter value: strictly increasing, so every open keys
 *  a brand-new mount (use as the setState updater: setSeq(nextFormOpenKey)). */
export function nextFormOpenKey(n: number): number {
  return n + 1;
}

/** Does a settled submit's response still own the sheet? Only a response from
 *  the CURRENT form-open may close it (and clear its deep-link intent); a
 *  response from an older, settled open — the deduped tail of a retry storm —
 *  must not touch the sheet that a newer open now holds. */
export function responseControlsSheet(responseOpenKey: number | undefined, currentOpenKey: number): boolean {
  if (responseOpenKey === undefined) return true; // defensive: legacy caller keeps today's behavior
  return responseOpenKey === currentOpenKey;
}

// ---------------------------------------------------------------------------
// THE OWNER'S FORM CONTRACT (audit Phase 2 part 2). Do not reword.
// ---------------------------------------------------------------------------

/** Exact helper text under the cost field. */
export const SERVICE_COST_HELPER_TEXT = "Saving this service will add this amount to Expenses.";
export const FUEL_COST_HELPER_TEXT = "Saving this fill-up will add this amount to Expenses.";
/** Draw helper text: the money was already expensed when the tank was bought. */
export const FUEL_DRAW_COST_HELPER_TEXT =
  "Recorded for economics only — a draw never adds an expense (the tank's fuel was expensed when purchased).";

/** The two explicit choices about the linked expense. */
export const TRACKING_ADD_EXPENSE_LABEL = "Add linked expense";
export const SERVICE_RECORD_ONLY_LABEL = "Service record only — no expense";
export const FUEL_RECORD_ONLY_LABEL = "Fill-up record only — no expense";

/** The owner's TWO-PATH fuel model (2026-10-20): the Add Fuel form's explicit
 *  kind choice. A PURCHASE is money leaving (station fill-up or bulk-tank
 *  delivery → exactly one linked expense); a DRAW is fuel taken from a tank
 *  that was already bought (usage only, never a second expense). */
export const FUEL_PURCHASE_CHOICE_LABEL = "Fuel purchase — add linked expense";
export const FUEL_PURCHASE_CHOICE_SUB = "Money leaves now — one expense (pump or bulk-tank delivery)";
export const FUEL_DRAW_CHOICE_LABEL = "Bulk-tank draw — usage only";
export const FUEL_DRAW_CHOICE_SUB = "No expense — the tank was already expensed when purchased";
/** The draw's honest edit-modal note (kind is preserved; never converted). */
export const FUEL_DRAW_EDIT_NOTE = "This is a bulk-tank draw — usage only. Editing never creates an expense.";
export const FUEL_PURCHASE_EDIT_NOTE = "This is a fuel purchase — corrections update the same linked expense.";

/** Submit labels track the money: the save WILL or WILL NOT write a ledger row. */
export const SERVICE_SUBMIT_WITH_EXPENSE = "Save service & add expense";
export const SERVICE_SUBMIT_RECORD_ONLY = "Save service (record only)";
export const FUEL_SUBMIT_WITH_EXPENSE = "Save fill-up & add expense";
export const FUEL_SUBMIT_RECORD_ONLY = "Save fill-up (record only)";
export const FUEL_DRAW_SUBMIT = "Save fuel usage (draw — no expense)";

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
export function fuelSubmitLabel(costCents: number | null, addExpense: boolean, kind: FuelRecordKind = "purchase"): string {
  if (kind === "draw") return FUEL_DRAW_SUBMIT;
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

/** Build the fuel submit payload (same contract as buildServiceSubmit, plus
 *  the two-path kind). A PURCHASE applies the linked-expense choice exactly as
 *  before (record-only sends no cost, so no $0 expense can be created). A DRAW
 *  always sends create_expense:false — no expense, ever — while its cost_cents
 *  (economics: the value of the fuel taken) still rides on the log; the
 *  dashboard reads exclude draws from spend. */
export function buildFuelSubmit(
  base: Omit<FuelLogInput, "client_request_id" | "create_expense" | "cost_cents" | "record_kind">,
  opts: { clientRequestId: string; addExpense: boolean; costCents: number | null; kind: FuelRecordKind }
): FuelLogInput {
  if (opts.kind === "draw") {
    return {
      ...base,
      client_request_id: opts.clientRequestId,
      record_kind: "draw",
      create_expense: false,
      cost_cents: opts.costCents,
    };
  }
  return {
    ...applyExpenseChoice(
      { ...base, client_request_id: opts.clientRequestId, create_expense: opts.addExpense, cost_cents: opts.costCents },
      opts.addExpense,
      opts.costCents
    ),
    record_kind: "purchase" as const,
  };
}

// ---------------------------------------------------------------------------
// Result banners — which thing actually happened, never an overclaim.
// ---------------------------------------------------------------------------

export type TrackingWriteResult =
  | { ok: true; expense_created: boolean; duplicate: boolean; record_kind?: FuelRecordKind }
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

/** A created fuel record's banner, per the owner's two-path rule. The wording
 *  is the owner's own (2026-10-20): a purchase says money was expensed once; a
 *  draw says usage was recorded and no expense was made. */
export function fuelCreatedMessage(res: TrackingWriteResult): TrackingResultMessage {
  if (!res.ok) return { kind: "error", text: res.error };
  if (res.duplicate) {
    return { kind: "success", text: "Already recorded — nothing changed." };
  }
  if (res.record_kind === "draw") {
    return {
      kind: "success",
      text: "Fuel usage recorded — no expense (drawn from an already-purchased tank).",
    };
  }
  if (res.expense_created) {
    return { kind: "success", text: "Fuel purchase recorded and expense added." };
  }
  return {
    kind: "success",
    text: "Fuel purchase recorded — no expense created (record only).",
  };
}

/** Edit banners (the restock precedent: cost kept vs cost removed). */
export function serviceEditedMessage(expenseLinked: boolean): string {
  return expenseLinked ? "Service record and linked expense updated." : "Service record updated — no linked expense.";
}
export function fuelEditedMessage(expenseLinked: boolean, kind: FuelRecordKind = "purchase"): string {
  if (kind === "draw") return "Fuel usage updated — a draw never creates an expense.";
  return expenseLinked ? "Fuel purchase and linked expense updated." : "Fuel purchase updated — no linked expense.";
}

/** Void banners state BOTH halves (restock precedent). */
export function serviceVoidedMessage(linkedExpenseRemoved: boolean): string {
  return linkedExpenseRemoved
    ? "Service record voided — the linked expense was removed."
    : "Service record voided — there was no linked expense.";
}
export function fuelVoidedMessage(linkedExpenseRemoved: boolean, kind: FuelRecordKind = "purchase"): string {
  if (kind === "draw") return "Fuel usage record voided — a draw has no expense to remove.";
  return linkedExpenseRemoved
    ? "Fuel purchase voided — the linked expense was removed."
    : "Fuel purchase voided — there was no linked expense.";
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
export function fuelVoidConfirmLines(
  hasLinkedExpense: boolean,
  amountCents: number | null,
  kind: FuelRecordKind = "purchase"
): string[] {
  if (kind === "draw") {
    return [
      "This removes the fuel usage record.",
      "A bulk-tank draw never created an expense — there is nothing to remove.",
    ];
  }
  if (!hasLinkedExpense) return ["This removes the fuel purchase record.", "There is no linked expense to remove."];
  return [
    "This removes the fuel purchase record and its linked expense.",
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
