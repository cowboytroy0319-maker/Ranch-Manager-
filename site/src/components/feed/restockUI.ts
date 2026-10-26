// ============================================================================
// Ranch Manager Pro — Restock UI helpers (pure, unit-testable).
// The one rule that matters here: the idempotency key (client_request_id) is
// generated ONCE per form-open and NEVER regenerated on retry — a double-tap
// or retry after a flaky network re-sends the SAME key, and the server's
// restock transaction dedupes on it (no double inventory, no double expense).
// ============================================================================
import type { RestockInput } from "~/server/feed";

export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Very old Safari fallback — still unique per call, just longer.
  return `rst-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// THE OWNER'S FORM CONTRACT (stage 2). These strings are the contract: the
// browser E2E asserts them verbatim, so change them only with the owner.
// ---------------------------------------------------------------------------

/** Exact helper text under the cost field. Do not reword. */
export const RESTOCK_COST_HELPER_TEXT = "Saving this restock will add this amount to Expenses.";

/** Submit label while a cost is present — the save WILL write a ledger row. */
export const RESTOCK_SUBMIT_WITH_EXPENSE = "Save restock & add expense";

/** Submit label with no cost — inventory only, and the app says so. */
export const RESTOCK_SUBMIT_INVENTORY_ONLY = "Save restock (inventory only)";

/** The two explicit choices about the linked expense. Do not reword. */
export const RESTOCK_ADD_EXPENSE_LABEL = "Add linked expense";
export const RESTOCK_INVENTORY_ONLY_LABEL = "Inventory only — no expense";

/** Shown when the operator left the cost blank but is still in "Add linked
 *  expense" mode — the app never invents a $0 expense, it asks. */
export const RESTOCK_COST_MISSING_ERROR =
  "Enter the total cost paid, or choose “Inventory only — no expense”.";

export type RestockFormState = {
  quantity: number | "";
  unit: string;
  restock_date: string;
  /** Raw text from the cost input (dollars) — "" means blank. */
  costDollars: string;
  vendor: string;
  notes: string;
  /** The "Add linked expense" choice (on by default when a cost is entered). */
  addExpense: boolean;
};

/** Dollars text → integer cents. Blank is null ("no expense"); anything
 *  unparseable is null too — never NaN, never a silent 0. */
export function parseCostToCents(input: string): number | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** The submit label tracks the money: a cost present (and the expense choice
 *  on) → "Save restock & add expense"; otherwise → inventory only. */
export function restockSubmitLabel(costCents: number | null, addExpense: boolean): string {
  return costCents !== null && addExpense ? RESTOCK_SUBMIT_WITH_EXPENSE : RESTOCK_SUBMIT_INVENTORY_ONLY;
}

/** Client-side form validation, mirroring the server's rules so the operator
 *  gets the message before a round trip. Returns null when the form is savable.
 *  A blank cost is fine — but only through the explicit "Inventory only — no
 *  expense" choice, so a $0 expense can never be created silently. */
export function validateRestockForm(
  form: RestockFormState,
  selected: { unit: string } | null
): string | null {
  if (!selected) return "Pick an item to restock.";
  if (form.quantity === "" || Number(form.quantity) <= 0) {
    return "Quantity added must be greater than zero.";
  }
  if (!form.restock_date) return "Restock date is required.";
  const cents = parseCostToCents(form.costDollars);
  if (form.addExpense && cents === null) return RESTOCK_COST_MISSING_ERROR;
  if (form.unit && form.unit !== selected.unit) {
    return `That item is counted in ${selected.unit}. Restock it in ${selected.unit}.`;
  }
  return null;
}

/** Build the server payload from the form state + the form-open idempotency
 *  key. Pure so the "same key on retry" invariant can be tested directly. */
export function buildRestockSubmit(
  form: {
    item_kind: "hay" | "feed";
    item_id: number;
    quantity: number;
    unit: string;
    restock_date: string;
    total_cost_cents: number | null;
    vendor: string | null;
    notes: string | null;
  },
  clientRequestId: string
): RestockInput {
  return {
    client_request_id: clientRequestId,
    item_kind: form.item_kind,
    item_id: form.item_id,
    quantity: form.quantity,
    unit: form.unit,
    restock_date: form.restock_date,
    total_cost_cents: form.total_cost_cents,
    vendor: form.vendor,
    notes: form.notes,
  };
}

export type RestockResponse =
  | { ok: true; id: number; expense_created: boolean; duplicate: boolean }
  | { ok: false; error: string };

/** The save result toast/message. MUST say which thing happened — the owner
 *  asked for it explicitly, and no overclaiming: no cost → no expense. */
export function restockResultMessage(res: RestockResponse): { kind: "success" | "error"; text: string } {
  if (!res.ok) return { kind: "error", text: res.error };
  if (res.expense_created) {
    return {
      kind: "success",
      text: res.duplicate
        ? "Already recorded — inventory and expense unchanged."
        : "Inventory updated and expense recorded.",
    };
  }
  return {
    kind: "success",
    text: res.duplicate
      ? "Already recorded — inventory unchanged."
      : "Inventory updated — no expense created (no cost entered).",
  };
}
