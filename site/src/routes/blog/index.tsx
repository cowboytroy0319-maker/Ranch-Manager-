import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/blog/")({
  component: BlogIndex,
});

const ARTICLES = [
  {
    href: "/blog/what-does-each-herd-really-cost",
    kicker: "Cost allocation",
    title: "What Does Each Herd Really Cost? A Straightforward Cost-Allocation Guide",
    desc: "Tag every expense as it happens — to the right herd, pasture, truck, or job — so 'which tractor cost me the most this year?' answers itself.",
    read: "5 min read",
  },
  {
    href: "/blog/what-do-i-need-to-do-today",
    kicker: "Daily operations",
    title: "What Do I Need to Do Today? A 5-Minute Morning Routine for the Ranch",
    desc: "Five questions, five minutes, and you head to the barn knowing what today actually needs instead of starting with a scramble.",
    read: "3 min read",
  },
];

function BlogIndex() {
  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="container-x flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-green-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M6 15c2 2 4 2 6 0s4-3 6-2" />
                <circle cx="8" cy="9" r="1" fill="currentColor" />
                <circle cx="16" cy="9" r="1" fill="currentColor" />
              </svg>
            </div>
            <span className="text-lg font-bold text-stone-900">Ranch Manager Pro</span>
          </Link>
          <Link to="/" className="btn-outline !py-2 !text-xs">Back to site</Link>
        </div>
      </header>

      <main className="container-x py-14 sm:py-20">
        <p className="eyebrow">Guides &amp; Resources</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold text-stone-900 sm:text-4xl">
          Practical guides for running the ranch
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-stone-600">
          Straightforward, value-first resources for the questions that come up at the
          gate, the barn, and the fuel tank — no fluff, no hard sell.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {ARTICLES.map((a) => (
            <Link
              key={a.href}
              to={a.href}
              className="group flex flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-green-700 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">{a.kicker}</span>
                <span className="text-xs text-stone-400">{a.read}</span>
              </div>
              <h2 className="mt-3 text-xl font-bold leading-snug text-stone-900 group-hover:text-green-800">
                {a.title}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-stone-600">{a.desc}</p>
              <span className="mt-4 text-sm font-semibold text-green-700 group-hover:text-green-900">
                Read the guide →
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-bold text-green-900">Want the same thinking as a working tool?</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-green-800">
            These guides are the paper version of the live app's math. Ranch Manager Pro logs costs
            and surfaces daily priorities automatically — try the interactive demo or the Daily
            Operations dashboard to see it in action.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/worksheet" className="rounded-lg bg-green-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-900">
              Get the Cost-Per-Head Worksheet
            </Link>
            <Link to="/demo" className="rounded-lg border border-green-700 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
              Try the interactive demo
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-stone-200 bg-white py-8">
        <div className="container-x text-center text-sm text-stone-500">
          © {new Date().getFullYear()} Ranch Manager Pro · Guides &amp; Resources
        </div>
      </footer>
    </div>
  );
}
