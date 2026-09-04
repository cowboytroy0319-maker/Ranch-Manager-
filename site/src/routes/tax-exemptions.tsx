import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { TaxExemptionFormModal } from "~/components/taxExemptions/TaxExemptionModals";
import { deleteTaxExemption, getTaxExemptionsData } from "~/server/taxExemptions";
import { UPCOMING_HORIZON_DAYS, type TaxExemptionRow } from "~/types/taxExemptions";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";

export const Route = createFileRoute("/tax-exemptions")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getTaxExemptionsData(),
  component: TaxExemptionsPage,
});

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const statusTone = (s: TaxExemptionRow["status"]): "green" | "amber" | "red" | "stone" =>
  s === "ok" ? "green" : s === "upcoming" ? "amber" : s === "expired" ? "red" : "stone";
const statusLabel = (s: TaxExemptionRow["status"]) =>
  s === "ok" ? "Valid" : s === "upcoming" ? "Expiring soon" : s === "expired" ? "Expired" : "No expiry";

function TaxExemptionsPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TaxExemptionRow | null>(null);
  const [busyDelete, setBusyDelete] = useState<number | null>(null);
  const [delError, setDelError] = useState<string | null>(null);

  const refresh = () => router.invalidate();

  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🗂️ Database not configured"
            sub="Tax & exemption records persist to Postgres — no connection string is set in this environment."
          />
          <p className="text-sm text-amber-800">
            Once a database is connected, <code>db:migrate</code> creates the{" "}
            <code>tax_exemptions</code> table and this page will show your tax
            identifiers and exemptions, with anything expiring or lapsed surfaced
            so you never miss a renewal.
          </p>
        </Card>
      </Shell>
    );
  }

  const remove = async (id: number, label: string) => {
    if (!confirm(`Remove "${label}" from the registry? This deletes the record.`)) return;
    setBusyDelete(id);
    setDelError(null);
    const res = await deleteTaxExemption({ data: { id } });
    setBusyDelete(id);
    if (res.ok) refresh();
    else setDelError(res.error);
    setBusyDelete(null);
  };

  const attention = [...data.expired, ...data.upcoming];

  return (
    <Shell>
      {delError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{delError}</div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="On record" value={String(data.exemptions.length)} sub="tax IDs & exemptions" accent />
        <Stat label="Expired" value={String(data.expired.length)} sub="needs renewal / re-file" />
        <Stat label="Expiring soon" value={String(data.upcoming.length)} sub={`within ${UPCOMING_HORIZON_DAYS} days`} />
        <Stat label="Valid / no expiry" value={String(data.active.length)} sub="in good standing" />
      </div>

      {/* Upcoming / expired surfacing — the core "don't let it lapse" value */}
      <Card className={attention.length ? "border-amber-300" : ""}>
        <CardTitle
          title="🚨 Upcoming & expired"
          sub="Anything at risk of lapsing — surfaced automatically from expiry dates"
          right={<Badge tone={attention.length ? "amber" : "green"}>{attention.length ? `${attention.length} to watch` : "Nothing to watch"}</Badge>}
        />
        {attention.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            No exemptions or registrations are expiring in the next {UPCOMING_HORIZON_DAYS} days, and nothing has lapsed.
            New dated records will land here automatically.
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
                    {r.entity ? ` · ${r.entity}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Status is computed from each record's expiry date relative to today. Records with no expiry date never surface here.
        </p>
      </Card>

      {/* Full registry */}
      <Card>
        <CardTitle
          title="Tax ID & exemption registry"
          sub="Every tax identifier, exemption, and registration on record"
          right={
            <button onClick={() => { setEditing(null); setAddOpen(true); }} className="rounded-lg border border-green-700/40 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800 transition hover:bg-green-100">
              + Add record
            </button>
          }
        />
        {data.exemptions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            No tax IDs or exemptions on record yet — or run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> for the demo registry.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-3">Identifier</th>
                  <th className="py-2 pr-3">Jurisdiction</th>
                  <th className="py-2 pr-3">Applies to</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.exemptions.map((r) => (
                  <tr key={r.id} className="transition hover:bg-green-50/50">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-stone-900">{r.identifier_type}</span>
                      {r.identifier_number && <span className="block font-mono text-xs text-stone-500">{r.identifier_number}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600">{r.jurisdiction}</td>
                    <td className="py-2.5 pr-3 text-stone-600">{r.entity ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-stone-600">{r.expires_on ? fmtDate(r.expires_on) : "Never"}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <button onClick={() => { setEditing(r); setAddOpen(true); }} className="mr-2 rounded-md border border-stone-200 px-2 py-1 text-xs font-semibold text-stone-600 transition hover:bg-stone-100">
                        Edit
                      </button>
                      <button
                        onClick={() => remove(r.id, r.identifier_type)}
                        disabled={busyDelete === r.id}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                      >
                        {busyDelete === r.id ? "…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Record-keeping disclaimer */}
      <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
        This registry is a <strong>record-keeping tool</strong> to help you track tax identifiers, exemptions, and registration
        expiry dates — it is <strong>not tax or legal advice</strong>. Renewal requirements, deadlines, and eligibility vary by
        jurisdiction; verify with your issuing office or a qualified professional. Jurisdiction and identifier fields are
        free-form so records for any state, province, or federal authority can be stored.
      </p>

      {addOpen && (
        <TaxExemptionFormModal
          editing={editing}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSaved={() => { setAddOpen(false); setEditing(null); refresh(); }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      badge="Tax &amp; Exemptions"
      eyebrow="Compliance module · live database"
      title="Tax Exemptions &amp; Registrations"
      subtitle="Exemption certificates and registrations with renewal dates — so nothing lapses at the feed store or county office."
    >
      {children}
    </AppShell>
  );
}
