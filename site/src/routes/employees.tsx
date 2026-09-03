import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { EmployeeFormModal } from "~/components/employees/EmployeesModals";
import { deleteEmployee, getEmployeesData } from "~/server/employees";
import { PAY_TYPE_LABEL, type EmployeeRow, type PayType } from "~/types/employees";
import { getSession } from "~/server/auth";

export const Route = createFileRoute("/employees")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getEmployeesData(),
  component: EmployeesPage,
});

// Money is stored as plain numeric dollars (locale-ready); the "$" lives only
// in the display layer. Locale formatting helpers below.
const fmtMoney = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtHours = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const payTone = (p: PayType): "green" | "blue" | "amber" =>
  p === "hourly" ? "green" : p === "salary" ? "blue" : "amber";

type Dim = "payType" | "crew" | "job";

function EmployeesPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [dim, setDim] = useState<Dim>("payType");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [busyDelete, setBusyDelete] = useState<number | null>(null);
  const [delError, setDelError] = useState<string | null>(null);

  const refresh = () => router.invalidate();

  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🧑🌾 Database not configured"
            sub="Employee & labor records persist to Postgres — no connection string is set in this environment."
          />
          <p className="text-sm text-amber-800">
            Once a database is connected, <code>db:migrate</code> creates the{" "}
            <code>employees</code> table and this page will show your roster, the
            labor-cost rollup, and labor cost per head / per hour.
          </p>
        </Card>
      </Shell>
    );
  }

  const dimRows =
    dim === "crew" ? data.byCrew : dim === "job" ? data.byJob : data.byPayType.map((r) => ({ ...r, name: PAY_TYPE_LABEL[r.name as PayType] ?? r.name }));
  const maxDim = Math.max(1, ...dimRows.map((r) => r.labor_cost));

  const remove = async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from the roster? This deletes their record.`)) return;
    setBusyDelete(id);
    setDelError(null);
    const res = await deleteEmployee({ data: { id } });
    setBusyDelete(null);
    if (res.ok) refresh();
    else setDelError(res.error);
  };

  return (
    <Shell>
      {delError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{delError}</div>
      )}

      {/* Top stats — labor-cost rollup feeding the cost-per-head picture */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total labor" value={fmtMoney(data.totalLabor)} sub="all workers, monthly" accent />
        <Stat label="Hours logged" value={fmtHours(data.totalHours)} sub={`${data.employees.filter((e) => e.pay_type === "hourly").length} hourly workers`} />
        <Stat label="Labor / hour" value={data.laborPerHour != null ? fmtMoney(data.laborPerHour) : "—"} sub="total ÷ hours logged" />
        <Stat label="Cost per head" value={data.laborPerHead != null ? fmtMoney(data.laborPerHead) : "—"} sub={`labor ÷ ${data.activeHead} active head`} />
        <Stat label="On roster" value={String(data.employees.length)} sub={`${data.activeHead} head on record`} />
      </div>

      {/* Roster + rollup breakdown */}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle
            title="Roster"
            sub="Workers, pay basis, and what each one costs this month"
            right={
              <button onClick={() => { setEditing(null); setAddOpen(true); }} className="rounded-lg border border-green-700/40 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800 transition hover:bg-green-100">
                + Add employee
              </button>
            }
          />
          {data.employees.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
              No workers on the roster yet — or run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> for the demo crew.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-3">Worker</th>
                    <th className="py-2 pr-3">Pay</th>
                    <th className="py-2 pr-3 text-right">Hours</th>
                    <th className="py-2 pr-3">Allocated to</th>
                    <th className="py-2 pr-3 text-right">Labor cost</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.employees.map((e) => (
                    <tr key={e.id} className="transition hover:bg-green-50/50">
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-stone-900">{e.name}</span>
                        {e.role && <span className="block text-xs text-stone-400">{e.role}</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={payTone(e.pay_type)}>{PAY_TYPE_LABEL[e.pay_type]}</Badge>
                        <span className="block text-xs text-stone-500">
                          {e.pay_type === "hourly"
                            ? `${fmtMoney(e.wage_rate ?? 0)}/hr`
                            : e.pay_type === "salary"
                              ? `${fmtMoney(e.salary_amount ?? 0)}/mo`
                              : `${fmtMoney(e.contract_amount ?? 0)}/mo`}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right text-stone-700">
                        {e.pay_type === "hourly" ? fmtHours(e.hours ?? 0) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-stone-600">
                        {[e.job && `Job: ${e.job}`, e.herd_group_name && e.herd_group_name, e.crew && e.crew]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium text-stone-800">
                        {fmtMoney(e.labor_cost)}
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right">
                        <button onClick={() => { setEditing(e); setAddOpen(true); }} className="mr-2 rounded-md border border-stone-200 px-2 py-1 text-xs font-semibold text-stone-600 transition hover:bg-stone-100">
                          Edit
                        </button>
                        <button
                          onClick={() => remove(e.id, e.name)}
                          disabled={busyDelete === e.id}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                        >
                          {busyDelete === e.id ? "…" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.employees.length > 0 && (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 p-3">
                  <span className="text-sm font-semibold text-green-900">Total labor · this month</span>
                  <span className="text-lg font-bold text-green-900">{fmtMoney(data.totalLabor)}</span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Labor-cost rollup breakdown */}
        <Card className="lg:col-span-2">
          <CardTitle title="Labor-cost rollup" sub="Break labor down by dimension" right={<Badge tone="green">Differentiator</Badge>} />
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-stone-200 p-1">
            {(["payType", "crew", "job"] as Dim[]).map((d) => (
              <button
                key={d}
                onClick={() => setDim(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition ${dim === d ? "bg-green-800 text-white" : "text-stone-600 hover:bg-stone-100"}`}
              >
                {d === "payType" ? "By pay type" : d === "crew" ? "By crew" : "By job"}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-stone-100">
            {dimRows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-3 py-2.5">
                <div className="w-40 shrink-0 truncate" title={r.name}>
                  <Badge tone="green">{r.name}</Badge>
                </div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(r.labor_cost / maxDim) * 100}%`, backgroundColor: ["#5a7d3a", "#8a5a2b", "#7b8fa3", "#b98a3a", "#4a6b8a", "#8a4a4a", "#5a8a78", "#6b5a8a"][i % 8] }} />
                </div>
                <span className="w-16 text-right text-sm font-semibold text-stone-800">{fmtMoney(r.labor_cost)}</span>
                <span className="w-10 text-right text-xs text-stone-400">{r.entries}×</span>
              </li>
            ))}
            {dimRows.length === 0 && <li className="py-3 text-sm text-stone-500">No labor to allocate yet.</li>}
          </ul>
          <p className="mt-4 rounded-xl bg-stone-100 p-3 text-xs text-stone-600">
            Labor cost per head of {data.activeHead > 0 ? fmtMoney(data.laborPerHead ?? 0) : "—"} feeds straight into the
            cost-per-head picture alongside feed, vet, and maintenance spend.
          </p>
        </Card>
      </div>

      {addOpen && (
        <EmployeeFormModal
          editing={editing}
          groups={data.groups}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSaved={() => { setAddOpen(false); setEditing(null); refresh(); }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-stone-100">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            <span className="hidden font-bold text-stone-900 sm:inline">Ranch Manager Pro</span>
          </Link>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            Employees &amp; Labor
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/livestock" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Livestock
          </Link>
          <Link to="/feed" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Feed &amp; Hay
          </Link>
          <Link to="/pasture" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Pasture
          </Link>
          <Link to="/equipment" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Equipment
          </Link>
          <Link to="/expenses" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Expenses
          </Link>
          <Link to="/tax-exemptions" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Tax &amp; Exemptions
          </Link>
          <Link to="/dashboard" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Daily Ops
          </Link>
          <Link to="/analytics" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
            Analytics
          </Link>
          <Link to="/" className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 md:inline">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">Sixth module · live database</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">Employees &amp; Payroll-Lite</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Your roster and the labor-cost rollup — what each worker costs this month, and labor
            cost per head / per hour feeding the cost picture.
          </p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro · Employees module (MVP)</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
