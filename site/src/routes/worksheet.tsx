import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/worksheet")({
  component: WorksheetPage,
});

const CATS = ["Feed & Hay", "Vet & Health", "Maintenance", "Insurance", "Fuel", "Other"];

function WorksheetPage() {
  return (
    <div className="min-h-dvh bg-stone-100 py-10 print:bg-white print:py-0">
      <main className="mx-auto max-w-3xl bg-white px-6 py-8 shadow-sm sm:px-10 print:max-w-none print:px-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-green-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-green-900">The Cost-Per-Head Worksheet</h1>
            <p className="mt-1 text-sm text-stone-600">
              One page to log what you spend and see it as cost per head, per acre, per bale.
            </p>
          </div>
          <div className="text-right text-xs text-stone-500">
            <p className="font-semibold uppercase tracking-wide text-stone-400">Month / Year</p>
            <p className="mt-1 border-b border-dashed border-stone-300 pb-1">________ / ______</p>
          </div>
        </div>

        {/* Step 0 — metrics */}
        <section className="pt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">
            Step 0 · Your numbers for this period
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Head count", "hundreds of head: ____"],
              ["Acres grazed", "total acres: ____"],
              ["Bales / tons of hay", "hay used: ____"],
              ["Miles / hours", "per truck/machine: ____"],
            ].map(([label, hint]) => (
              <div key={label} className="rounded-lg border border-stone-200 p-3">
                <div className="text-xs font-semibold text-stone-700">{label}</div>
                <div className="mt-1 h-7 border-b border-dashed border-stone-300 text-xs text-stone-400">{hint.split(": ")[1]}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Step 1 — the log */}
        <section className="pt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">
            Step 1 · The monthly cost log
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            One line per purchase. “Allocated to” matches how the app splits spend across a herd/group,
            pasture, equipment, or job.
          </p>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-stone-300 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2">Vendor</th>
                <th className="py-2 pr-2">Allocated to</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }).map((_, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="h-8 py-1 pr-2 text-xs" />
                  <td className="h-8 py-1 pr-2 text-xs" />
                  <td className="h-8 py-1 pr-2 text-xs" />
                  <td className="h-8 py-1 pr-2 text-xs" />
                  <td className="h-8 py-1 text-right text-xs" />
                </tr>
              ))}
              <tr className="border-t-2 border-stone-300">
                <td className="py-2 pr-2 font-bold text-stone-800" colSpan={4}>
                  Total spend this period
                </td>
                <td className="py-2 text-right font-bold text-green-900">$ ______</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {CATS.map((c) => (
              <span key={c} className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">
                {c}
              </span>
            ))}
          </div>
        </section>

        {/* Step 2 — the per-unit math */}
        <section className="pt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">
            Step 2 · The per-unit math
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Total spend ÷ each of the numbers you wrote in Step 0.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {[
              ["Cost per head", "Total ÷ head count", "$ ____ / head"],
              ["Cost per acre", "Total ÷ acres grazed", "$ ____ / acre"],
              ["Hay cost per bale", "Hay spend ÷ bales used", "$ ____ / bale"],
              ["Cost per mile / hour", "Fuel & maintenance ÷ miles or hours", "$ ____ / mi or hr"],
            ].map(([label, expr, out]) => (
              <div key={label} className="rounded-lg border border-stone-200 p-3">
                <div className="text-sm font-semibold text-stone-800">{label}</div>
                <div className="text-xs text-stone-500">{expr}</div>
                <div className="mt-2 rounded bg-green-50 px-2 py-1.5 text-sm font-bold text-green-900">
                  {out}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Step 3 — what it tells you */}
        <section className="pt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Step 3 · What it tells you</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            <li>Which herd group, pasture, or machine eats the most — so you can decide on a change.</li>
            <li>Whether your feed, fuel, or replacement costs are creeping up from last period.</li>
            <li>A fair “cost per head” to compare against past quarters, other sites, or custom-grazing rates.</li>
          </ul>
        </section>

        {/* Footer / tie-back */}
        <div className="mt-7 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 print:border-dashed">
          <p className="font-semibold">This worksheet is the paper version of the live app's math.</p>
          <p className="mt-1 text-green-800">
            Ranch Manager Pro's <strong>Expenses &amp; Cost Allocation</strong> module does every line above
            automatically from your logged expenses — no spreadsheet, no carrying totals yourself. Every
            purchase is assigned to a herd/group, pasture, equipment, or job, and reports show cost per
            head, per acre, per bale, and per mile right on the dashboard.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/expenses" className="rounded-lg bg-green-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-900">
              See the live cost module →
            </Link>
            <Link to="/demo" className="rounded-lg border border-green-700 px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
              Try the interactive demo
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 print:hidden"
            >
              🖨️ Print this page
            </button>
          </div>
          <p className="mt-3 border-t border-green-200 pt-2 text-xs text-green-800 print:hidden">
            Signing up for the checklist? Every plan includes a free trial at signup — 1 free month (Legacy: 2 free
            months) — no credit card required until you're sure it's what your notebook isn't.
          </p>
        </div>

        {/* Print-only footer copyright */}
        <p className="mt-8 hidden text-center text-xs text-stone-400 print:block">
          © {new Date().getFullYear()} Ranch Manager Pro · The Cost-Per-Head Worksheet · ranchmanagerpro
        </p>
      </main>
    </div>
  );
}
