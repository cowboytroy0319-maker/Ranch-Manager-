// ============================================================================
// Ranch Manager Pro — Expenses route UI helpers (pure, unit-testable).
// The route component stays a thin renderer; everything here is plain data
// mapping so the ?add=expense intent wiring, the filter parsing, and the
// linked-source indicators are assertable without a DOM.
// ============================================================================
import type { ExpenseRow } from "~/types/expenses";

/** The add intents the /expenses route honors (MobileNav links ?add=expense). */
export const EXPENSE_ADD_INTENTS = ["expense"] as const;
export type ExpenseAddIntent = (typeof EXPENSE_ADD_INTENTS)[number];

/** Parse a raw ?add= query value into a known intent, or null. Mirrors the
 *  logic inside useAddIntent so the route's wiring is testable in isolation. */
export function parseAddIntent(raw: unknown, possible: readonly string[]): string | null {
  return typeof raw === "string" && possible.includes(raw) ? raw : null;
}

/** Route search shape for /expenses (validated by validateSearch). */
export type ExpenseSearch = {
  add?: string;
  from?: string;
  to?: string;
  category?: string;
};

/** Build the validated route search from raw URL params — anything unknown is
 *  dropped so a stray query can't reach the loader or the DB. */
export function expenseFilterFromSearch(search: Record<string, unknown>): ExpenseSearch {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const date = (v: unknown): string | undefined => {
    const s = str(v);
    // Shape AND calendar validity — a shape-valid non-date like 2026-13-99
    // must never reach the ledger query as a bound parameter.
    return s && dateRe.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
  };
  return {
    add: str(search.add),
    from: date(search.from),
    to: date(search.to),
    category: str(search.category),
  };
}

/** What a list row shows for its origin. Linked expenses (source_type set)
 *  get a source label plus a source-management action link to the closest
 *  practical screen; manual rows say so. The expense itself has no Delete and
 *  no Edit on linked rows — it is corrected at its source. No overclaiming: a
 *  restock has no dedicated detail screen this release, so its link goes to
 *  the Hay & Feed module (labeled as such), while a pasture activity links to
 *  its pasture's detail view when the pasture id is on the row (module page
 *  otherwise — the link always works, the label says where it lands). */
export function expenseSourceIndicator(
  row: Pick<ExpenseRow, "source_type" | "source_id" | "pasture_id">
): { label: string; to: string; actionLabel: string; hint: string } | null {
  if (row.source_type === "restock") {
    return {
      label: "↳ hay/feed restock",
      to: "/feed",
      actionLabel: "Open in Hay & Feed",
      hint: "Created from a restock — corrected there, not here",
    };
  }
  if (row.source_type === "pasture_activity") {
    return {
      label: "↳ pasture activity",
      to: row.pasture_id != null ? `/pasture?open=${row.pasture_id}` : "/pasture",
      actionLabel: "Open in Pasture",
      hint: "Created from a pasture activity — corrected there, not here",
    };
  }
  return null;
}

/** Row badge text for non-linked expenses. */
export const MANUAL_SOURCE_LABEL = "manual";
