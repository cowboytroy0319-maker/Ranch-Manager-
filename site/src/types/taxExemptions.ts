// ============================================================================
// Ranch Manager Pro — Tax & ag-exemption registry module types (shared client +
// server). JSON-safe values (dates are strings).
//
// Jurisdiction-aware and region/locale-ready: `jurisdiction` is free text
// (state/province/jurisdiction — not hard-coded to US states) and
// `identifier_number` is TEXT because tax IDs / exemption numbers are
// identifiers (letters, dashes, leading zeros), NOT integers and NOT money — so
// this module carries no currency/locale formatting concerns at all.
//
// Status is derived at read time from `expires_on` (NULL = never expires):
//   expired  = expires_on < today
//   upcoming = within the next UPCOMING_HORIZON_DAYS (default 90) and not expired
//   ok       = valid and beyond the horizon
//   none     = no expiry date set
// ============================================================================

/** Common identifier types offered as suggestions in the form (users may type
 * any other value — kept free-text so provinces/regions and custom kinds fit). */
export const IDENTIFIER_TYPE_SUGGESTIONS = [
  "Sales-tax ag exemption",
  "Employer ID (EIN)",
  "Business number (BN)",
  "Ag-use valuation application",
  "Brand registration",
  "Other",
] as const;

/** Horizon (days) within which a future expiry counts as "upcoming". */
export const UPCOMING_HORIZON_DAYS = 90;

export type TaxExemptionStatus = "expired" | "upcoming" | "ok" | "none";

/** A single registry row with the derived status resolved by the server. */
export type TaxExemptionRow = {
  id: number;
  identifier_type: string;
  identifier_number: string | null;
  jurisdiction: string;
  entity: string | null;
  expires_on: string | null; // YYYY-MM-DD
  contact: string | null;
  notes: string | null;
  status: TaxExemptionStatus;
  created_at: string;
  updated_at: string;
};

export type TaxExemptionData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  exemptions: TaxExemptionRow[]; // all rows, sorted by expires_on (nulls last)
  expired: TaxExemptionRow[]; // surfaced for action — lapsed
  upcoming: TaxExemptionRow[]; // within the horizon, not yet expired
  active: TaxExemptionRow[]; // everything valid & beyond the horizon (incl. no-expiry)
};

/** Input for create/update — mirrors TaxExemptionRow minus the derived fields. */
export type TaxExemptionInput = {
  id?: number;
  identifier_type: string;
  identifier_number: string | null;
  jurisdiction: string;
  entity: string | null;
  expires_on: string | null;
  contact: string | null;
  notes: string | null;
};
