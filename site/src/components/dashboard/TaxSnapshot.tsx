// ============================================================================
// Ranch Manager Pro — Daily Operations: Tax & exemption snapshot. Surfaces
// anything expiring or already lapsed right on the "What do I need to do
// today?" board so a renewal or re-file isn't missed. Record-keeping only.
// ============================================================================
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardTitle } from "~/components/ui";
import type { TaxExemptionData, TaxExemptionRow } from "~/types/taxExemptions";

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const tone = (s: TaxExemptionRow["status"]): "green" | "amber" | "red" | "stone" =>
  s === "ok" ? "green" : s === "upcoming" ? "amber" : s === "expired" ? "red" : "stone";
const label = (s: TaxExemptionRow["status"]) =>
  s === "ok" ? "Valid" : s === "upcoming" ? "Expiring soon" : s === "expired" ? "Expired" : "No expiry";

export function TaxSnapshot({ data }: { data: TaxExemptionData }) {
  const attention = [...data.expired, ...data.upcoming];
  if (!data.configured) return null;

  return (
    <Card className={attention.length ? "border-amber-300" : ""}>
      <CardTitle
        title="🗂️ Tax & exemptions"
        sub="Renewals, ag-exemptions, and registrations to watch"
        right={<Badge tone={attention.length ? "amber" : "green"}>{attention.length ? `${attention.length} to watch` : "Nothing due"}</Badge>}
      />
      {attention.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
          No tax IDs or exemptions are expiring soon, and nothing has lapsed.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {attention.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-lg px-2 py-2.5 ${r.status === "expired" ? "bg-red-50/60" : "bg-amber-50/50"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900">
                  {r.identifier_type}{r.identifier_number ? ` · ${r.identifier_number}` : ""}
                </p>
                <p className="text-xs text-stone-500">
                  {r.jurisdiction}
                  {r.expires_on ? ` · ${r.status === "expired" ? "expired" : "expires"} ${fmtDate(r.expires_on)}` : ""}
                </p>
              </div>
              <Badge tone={tone(r.status)}>{label(r.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3">
        <Link to="/tax-exemptions" className="text-sm font-medium text-green-700 hover:text-green-900">
          Open the full registry →
        </Link>
      </p>
    </Card>
  );
}
