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

/** Parse the dollars text field of the edit-restock form into cents-or-null.
 *  Pure: blank/zero/negative-or-garbage → null (no linked expense); the
 *  server validator still owns the final say on quantity/date. */
export function parseEditCostDollars(raw: string): number | null {
  const t = (raw ?? "").trim();
  if (t === "") return null;
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

/** Outcome message after a successful updateRestock — must not overclaim:
 *  only reports a linked expense when one actually exists. Pure for tests. */
export function editRestockSavedMessage(hasExpense: boolean, costCents: number | null): string {
  return hasExpense || (costCents != null && costCents > 0)
    ? "Restock updated — inventory and linked expense now match."
    : "Restock updated — no linked expense (no cost entered).";
}

/** Outcome message after a successful deleteRestock. Pure for tests. */
export function voidRestockMessage(linkedExpenseRemoved: boolean): string {
  return linkedExpenseRemoved
    ? "Restock voided — inventory reversed and the linked expense removed."
    : "Restock voided — inventory reversed.";
}
