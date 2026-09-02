import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { COSTS_YTD, FEED_INVENTORY, LIVESTOCK, TOTAL_AU } from "~/data/sample";
import { createCheckout } from "~/server/checkout";
import { subscribeEmail } from "~/server/subscribers";

export const Route = createFileRoute("/")({
  component: LandPage,
});

// --- tiny inline sparkline/bar helpers for the dashboard preview ------------
const maxCost = Math.max(...COSTS_YTD.map((c) => c.ytd));
const maxHead = Math.max(...LIVESTOCK.map((s) => s.head));

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-green-950/90 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-green-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M6 15c2 2 4 2 6 0s4-3 6-2" />
              <circle cx="8" cy="9" r="1" fill="currentColor" />
              <circle cx="16" cy="9" r="1" fill="currentColor" />
            </svg>
          </div>
          <span className="text-lg font-bold text-white">Ranch Manager Pro</span>
        </div>
        <nav className="hidden items-center gap-7 text-sm font-medium text-stone-200 md:flex">
          <a href="#modules" className="hover:text-white">What it covers</a>
          <a href="#who" className="hover:text-white">Who it's for</a>
          <Link to="/livestock" className="hover:text-white">Livestock</Link>
          <Link to="/feed" className="hover:text-white">Feed &amp; Hay</Link>
          <Link to="/pasture" className="hover:text-white">Pasture</Link>
          <Link to="/equipment" className="hover:text-white">Equipment</Link>
          <Link to="/expenses" className="hover:text-white">Expenses</Link>
          <Link to="/employees" className="hover:text-white">Employees</Link>
          <Link to="/tax-exemptions" className="hover:text-white">Tax &amp; Exemptions</Link>
          <Link to="/dashboard" className="hover:text-white">Daily Ops</Link>
          <Link to="/blog" className="hover:text-white">Guides</Link>
          <a href="#pricing" className="hover:text-white">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/livestock" className="btn-ghost !py-2.5">Livestock</Link>
          <Link to="/feed" className="btn-ghost !py-2.5">Feed &amp; Hay</Link>
          <Link to="/pasture" className="btn-ghost !py-2.5">Pasture</Link>
          <Link to="/equipment" className="btn-ghost !py-2.5">Equipment</Link>
          <Link to="/employees" className="btn-ghost !py-2.5">Employees</Link>
          <Link to="/tax-exemptions" className="btn-ghost !py-2.5">Tax &amp; Exemptions</Link>
          <Link to="/dashboard" className="btn-ghost !py-2.5">Daily Ops</Link>
          <Link to="/demo" className="btn-primary !py-2.5">
            View Live Demo
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-green-950 text-white">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-green-700/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-80 w-80 rounded-full bg-amber-700/20 blur-3xl" />
      <div className="container-x relative grid items-center gap-12 py-20 md:grid-cols-2 md:py-28">
        <div>
          <p className="eyebrow !text-green-300">Ranches · Farms · Every scale</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
            Your whole operation, in one clean view.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-200">
            Track livestock, pasture, hay & feed, equipment, fuel, and every
            registration and policy — replacing the paper trail with real-time
            operational visibility and cost reporting for a family ranch, a
            grazing farm, or a 5,000-head commercial operation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo" className="btn-primary !bg-amber-500 !text-green-950 hover:!bg-amber-400">
              View Live Demo →
            </Link>
            <a href="#modules" className="btn-outline !border-white/30 !bg-white/5 !text-white hover:!bg-white/10">
              See what it covers
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-stone-300">
            <span>✓ Built for one ranch or many sites</span>
            <span>✓ Pasture & forage intelligence per region</span>
            <span>✓ Horse energy & feed matching</span>
          </div>
          <Link
            to="/dashboard"
            className="mt-8 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
          >
            🌅 See the Daily Operations morning briefing →
          </Link>
        </div>

        {/* Dashboard preview card */}
        <div className="rounded-2xl border border-white/10 bg-white p-5 text-stone-900 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Live overview</p>
              <p className="font-bold">Spring Valley Operations · Sample</p>
            </div>
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">All systems normal</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Total AU</p>
              <p className="text-xl font-bold">{TOTAL_AU.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Hay on hand</p>
              <p className="text-xl font-bold">{FEED_INVENTORY[0].onHand} bales</p>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs text-stone-500">YTD spend</p>
              <p className="text-xl font-bold">${Math.round(COSTS_YTD.reduce((s, c) => s + c.ytd, 0) / 1000)}k</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {LIVESTOCK.slice(0, 4).map((s) => (
              <div key={s.key} className="flex items-center gap-3">
                <span className="w-16 text-xs font-medium text-stone-600">{s.label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${(s.head / maxHead) * 100}%`, backgroundColor: s.color }} />
                </div>
                <span className="w-12 text-right text-xs font-semibold">{s.head.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-stone-200 p-3 text-center">
            <Link to="/demo" className="text-sm font-semibold text-green-700 hover:text-green-900">
              Open the full interactive demo →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Modules() {
  const mods = [
    { icon: "🐄", title: "Livestock", desc: "Head counts by species, herd health records, and horse energy & calorie tracking." },
    { icon: "🌾", title: "Hay & Feed", desc: "Bale and tonnage inventory, feed levels, and low-stock reorder alerts." },
    { icon: "🌱", title: "Pasture Management", desc: "Grazing assignments plus regional/climate forage intelligence, forage-for-animal matching, and grazing-system & ration guidance." },
    { icon: "🚜", title: "Equipment & Vehicles", desc: "Fleet register with service-due tracking and downtime visibility." },
    { icon: "🔧", title: "Maintenance", desc: "Preventive maintenance schedules and one-tap mark-done logging." },
    { icon: "📑", title: "Registrations & Compliance", desc: "Vehicle tags, inspections, permits, and brand checks in one calendar." },
    { icon: "🛡️", title: "Insurance", desc: "Policies, renewals, and coverage due dates for every site." },
    { icon: "⛽", title: "Fuel Tracking", desc: "Tank levels, gallons used, and monthly fuel expense by machine or site." },
    { icon: "🧑🌾", title: "Employees & Labor", desc: "Roster with pay type and hours, plus a labor-cost rollup — cost per head and per hour." },
    { icon: "🗂️", title: "Tax & Ag-Exemptions", desc: "Track tax IDs, exemptions, and registrations by jurisdiction — with expiring or lapsed ones surfaced so nothing slips." },
  ];
  return (
    <section id="modules" className="bg-stone-50 py-20">
      <div className="container-x">
        <p className="eyebrow">What it covers</p>
        <h2 className="mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">
          Every record your operation depends on — in one place
        </h2>
        <p className="mt-3 max-w-2xl text-stone-600">
          Nine core modules replace the spreadsheets and filing cabinets that
          hold your operation together, with cost and compliance threaded through
          each one.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {mods.map((m) => (
            <div key={m.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="text-3xl">{m.icon}</div>
              <h3 className="mt-3 text-lg font-semibold text-stone-900">{m.title}</h3>
              <p className="mt-1.5 text-sm text-stone-600">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Who() {
  const ops = [
    { title: "Small family ranches", body: "A single herd, a few paddocks, one truck — keep it simple without losing the records." },
    { title: "Horse facilities", body: "Horse energy tracking and feed matching for every animal in the barn." },
    { title: "Farms of every kind", body: "The pasture module brings grazing-land and crop-rotation oversight to farms too." },
    { title: "Large commercial operations", body: "5,000-head+ herds, multiple counties, and management teams get site-by-site control." },
  ];
  return (
    <section id="who" className="bg-green-950 py-20 text-white">
      <div className="container-x">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <p className="eyebrow !text-green-300">Who it's for</p>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Ranches AND farms. One acre to 100,000.</h2>
            <p className="mt-4 text-lg text-stone-200">
              We built for the flock of sheep on the family place and the
              multi-site feeding program's nutrition team with the same care.
              Start with one pasture or oversee twenty — the platform scales to
              match, never overwhelms.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {ops.map((o) => (
              <div key={o.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="font-semibold text-white">{o.title}</h3>
                <p className="mt-1.5 text-sm text-stone-300">{o.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Differentiators() {
  return (
    <section className="bg-white py-20">
      <div className="container-x">
        <p className="eyebrow">Built-in intelligence</p>
        <h2 className="mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">Two features you won't want to run without</h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-green-800/20 bg-green-50 p-8">
            <h3 className="text-2xl font-bold text-green-900">Regional pasture & forage intelligence</h3>
            <p className="mt-3 text-stone-700">
              Region-aware guidance on water needs, fertilization, and the best
              grass for your climate — matched to the animal: cattle, horses
              (with fescue cautions), goats, and sheep. Compare rotational vs.
              single-pasture vs. feedlot, and get grass-to-grain ration ratios
              for finishing operations.
            </p>
            <Link to="/demo" className="mt-5 inline-flex font-semibold text-green-700 hover:text-green-900">
              Explore it in the demo (sample: Texas) →
            </Link>
          </div>
          <div className="rounded-3xl border border-amber-800/20 bg-amber-50 p-8">
            <h3 className="text-2xl font-bold text-amber-900">Horse energy & calorie estimator</h3>
            <p className="mt-3 text-stone-700">
              Estimate a horse's daily calorie needs from body weight and
              workload — maintenance through very heavy work and breeding — then
              get a rough forage + feed match so every horse gets exactly what it
              burns.
            </p>
            <Link to="/demo" className="mt-5 inline-flex font-semibold text-amber-800 hover:text-amber-900">
              Try the calculator in the demo →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tiers = [
    {
      name: "Herd",
      key: "herd",
      price: "$15",
      annualPrice: "$165",
      tagline: "Single operation, core daily toolkit",
      features: ["One ranch / farm operation", "Livestock, pasture, hay & feed core records", "Fuel, maintenance & registrations", "Daily 'what do I need to do today' view"],
      badge: "Everything you need day to day",
      annualFree: "1 month free on annual",
      highlight: false,
    },
    {
      name: "Ranch",
      key: "ranch",
      price: "$30",
      annualPrice: "$330",
      tagline: "Multi-site operations, cost allocation & advanced reports",
      features: ["Everything in Herd", "Multi-site / multi-pasture operations", "Full multi-dimensional cost allocation", "Advanced cost & margin reports per site"],
      badge: "Best fit for growing operations",
      annualFree: "1 month free on annual",
      highlight: true,
    },
    {
      name: "Manager",
      key: "manager",
      price: "$75",
      annualPrice: "$825",
      tagline: "Large / multi-operation management teams",
      features: ["Everything in Ranch", "Advanced regional pasture & forage intelligence", "Forage-for-animal & grazing-system guidance", "Multi-user team access with roles"],
      badge: "For teams & multi-operation oversight",
      annualFree: "1 month free on annual",
      highlight: false,
    },
    {
      name: "Legacy",
      key: "legacy",
      price: "$200",
      annualPrice: "$2,000",
      tagline: "Unlimited features — everything included",
      features: ["Unlimited operations, users & sites", "Every module at full depth", "Priority onboarding & support", "Best value for large operations"],
      badge: "Everything included, no limits",
      annualFree: "2 months free on annual",
      highlight: false,
    },
  ];

  const startCheckout = async (t: (typeof tiers)[number]) => {
    if (busy) return;
    setBusy(t.name);
    setError(null);
    try {
      const res = await createCheckout({
        data: {
          tier: t.key,
          billing,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
      });
      if (!res.ok) {
        setError(res.error);
        setBusy(null);
        return;
      }
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <section id="pricing" className="bg-white py-20">
      <div className="container-x">
        <p className="eyebrow">Pricing</p>
        <h2 className="mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">Simple plans that scale with your operation</h2>
        <p className="mt-3 max-w-2xl text-stone-600">
          Every plan includes the full daily toolkit — upgrade for more sites, deeper reporting, and
          management-team features. Checkout is secure and handled by Stripe.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3 rounded-full border border-stone-200 bg-stone-50 px-4 py-2">
            <span className={`text-sm font-semibold ${billing === "monthly" ? "text-green-800" : "text-stone-400"}`}>Monthly</span>
            <button
              type="button"
              onClick={() => setBilling(billing === "monthly" ? "annual" : "monthly")}
              aria-label="Toggle monthly or annual billing"
              className="relative h-6 w-12 rounded-full bg-green-700 transition"
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  billing === "annual" ? "left-7" : "left-1"
                }`}
              />
            </button>
            <span className={`text-sm font-semibold ${billing === "annual" ? "text-green-800" : "text-stone-400"}`}>Annual</span>
          </div>
          <span className="text-sm text-stone-600">
            Pay annually — <span className="font-semibold text-green-800">Herd, Ranch &amp; Manager get 1 month free</span>;{" "}
            <span className="font-semibold text-green-800">Legacy gets 2 months free</span>.
          </span>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-6 shadow-sm ${
                t.highlight ? "border-green-700 bg-green-50" : "border-stone-200 bg-white"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-green-700 px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold text-stone-900">{t.name}</h3>
              <p className="mt-2 text-3xl font-bold text-stone-900">
                {billing === "annual" ? t.annualPrice : t.price}
                <span className="text-base font-medium text-stone-500">{billing === "annual" ? "/yr" : "/mo"}</span>
              </p>
              {billing === "annual" && <p className="mt-1 text-xs font-semibold text-green-700">{t.annualFree}</p>}
              <p className="mt-2 min-h-10 text-sm text-stone-600">{t.tagline}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-stone-700">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-green-700">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-lg bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
                {t.badge}
              </p>
              <button
                type="button"
                onClick={() => startCheckout(t)}
                disabled={busy !== null}
                className={`mt-3 block w-full rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  t.highlight
                    ? "bg-green-700 text-white hover:bg-green-800"
                    : "border border-green-700 bg-white text-green-800 hover:bg-green-50"
                }`}
              >
                {busy === t.name
                  ? "Starting checkout…"
                  : `Get started — ${billing === "annual" ? `${t.annualPrice}/yr` : `${t.price}/mo`}`}
              </button>
            </div>
          ))}
        </div>

        {error && <p className="mt-6 text-center text-sm font-medium text-red-600">{error}</p>}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border border-stone-200 bg-stone-50 px-6 py-5 text-sm text-stone-600">
          <span className="font-semibold text-stone-800">Secure checkout by Stripe</span>
          <span>Pay by card</span>
          <span>Free trial at signup — 1 free month (Legacy: 2 free months)</span>
          <span>Plans auto-renew — cancel anytime</span>
        </div>
        <p className="mt-6 text-center text-xs text-stone-400">
          All plans include a free trial at signup (Herd, Ranch &amp; Manager: 1 free month; Legacy: 2 free months).
          Subscriptions auto-renew until you cancel. Payments are processed securely by Stripe. The interactive demo and
          Daily Operations dashboard are live today.
        </p>
      </div>
    </section>
  );
}

function Preview() {
  return (
    <section id="preview" className="bg-stone-50 py-20">
      <div className="container-x text-center">
        <p className="eyebrow">The dashboard</p>
        <h2 className="mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">Watch the demo come to life</h2>
        <p className="mx-auto mt-3 max-w-2xl text-stone-600">
          A clickable, tabbed dashboard populated with realistic sample data —
          livestock by species, hay & feed levels, pasture assignments, regional
          forage guidance, equipment maintenance, registrations, fuel, and costs.
          No database, no setup — just push the button.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/demo" className="btn-primary">
            Launch the demo module →
          </Link>
          <Link to="/dashboard" className="btn-outline">
            🌅 Open the Daily Ops dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

function EmailSignup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await subscribeEmail({ data: { email, name: name || null } });
      if (!res.ok) {
        setError("Please enter a valid email address.");
        setBusy(false);
        return;
      }
      setDone(true);
      setEmail("");
      setName("");
      setBusy(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <section id="updates" className="bg-green-950 py-20 text-white">
      <div className="container-x grid items-center gap-10 md:grid-cols-2">
        <div>
          <p className="eyebrow !text-green-300">Free one-page resource</p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
            Get the free Cost-Per-Head Worksheet
          </h2>
          <p className="mt-3 max-w-md text-stone-200">
            A printable one-pager to log what your operation spends — by herd, pasture,
            equipment, and job — then see it as cost per head, per acre, and per bale.
            It's the exact math our live Expenses &amp; Cost Allocation module does
            automatically. Enter your email and it's yours, free.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-green-100">
            <li className="flex gap-2"><span>✓</span> Printable — works at the gate or in the shop</li>
            <li className="flex gap-2"><span>✓</span> Log &amp; per-unit math on one page</li>
            <li className="flex gap-2"><span>✓</span> See it working in the live demo, free</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur">
          {done ? (
            <div className="rounded-xl bg-green-600/20 px-4 py-4 text-green-100">
              <div className="flex items-center gap-3">
                <span className="text-xl">🎉</span>
                <div>
                  <p className="font-semibold text-white">You're on the list — here's your worksheet.</p>
                  <p className="text-sm text-green-100/80">
                    We've added you to our updates list (unsubscribe anytime).
                  </p>
                </div>
              </div>
              <Link
                to="/worksheet"
                className="mt-4 block w-full rounded-xl bg-amber-500 px-4 py-3 text-center text-sm font-bold text-green-950 transition hover:bg-amber-400"
              >
                View &amp; print your Cost-Per-Head Worksheet →
              </Link>
              <p className="mt-3 text-center text-xs text-green-100/80">
                Want to see it in action without any math? The live demo and the
                Daily Operations dashboard are already live — and every plan starts
                with a free month (Legacy: 2 free months) when you're ready.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor="signup-name" className="mb-1 block text-sm font-medium text-stone-200">
                  Name <span className="text-stone-400">(optional)</span>
                </label>
                <input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-stone-300 outline-none transition focus:border-green-400"
                />
              </div>
              <div>
                <label htmlFor="signup-email" className="mb-1 block text-sm font-medium text-stone-200">
                  Email <span className="text-red-300">*</span>
                </label>
                <input
                  id="signup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@ranch.com"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-stone-300 outline-none transition focus:border-green-400"
                />
              </div>
              {error && <p className="text-sm text-red-300">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full !bg-amber-500 !text-green-950 hover:!bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Sending…" : "Get the free worksheet"}
              </button>
              <p className="text-center text-xs text-stone-400">
                By signing up you opt in to product-update emails and we send you the
                free worksheet. Unsubscribe anytime.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-white py-10">
      <div className="container-x">
        <div className="flex flex-col items-start justify-between gap-8 text-sm text-stone-500 sm:flex-row">
          <div className="max-w-xs">
            <p className="font-bold text-stone-900">Ranch Manager Pro</p>
            <p className="mt-1.5">
              Ranch &amp; farm management for livestock, pasture, feed, equipment, fuel,
              registrations, insurance, and costs — at every scale.
            </p>
          </div>
          <nav aria-label="Resources" className="grid grid-cols-2 gap-x-12 gap-y-2">
            <p className="col-span-2 text-xs font-semibold uppercase tracking-[0.18em] text-green-700">Guides &amp; Resources</p>
            <Link to="/blog" className="hover:text-green-800">All guides</Link>
            <Link to="/employees" className="hover:text-green-800">Live Employees module</Link>
            <Link to="/tax-exemptions" className="hover:text-green-800">Live Tax &amp; Exemptions module</Link>
            <Link to="/blog/what-does-each-herd-really-cost" className="hover:text-green-800">Cost-per-herd guide</Link>
            <Link to="/blog/what-do-i-need-to-do-today" className="hover:text-green-800">5-minute morning routine</Link>
            <Link to="/worksheet" className="hover:text-green-800">Cost-Per-Head Worksheet</Link>
          </nav>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro. Sample data shown; MVP in progress.</span>
          <span>Ranches · Farms · Every scale</span>
        </div>
      </div>
    </footer>
  );
}

function LandPage() {
  return (
    <div className="bg-stone-50">
      <Nav />
      <Hero />
      <Modules />
      <Differentiators />
      <Pricing />
      <Who />
      <Preview />
      <EmailSignup />
      <Footer />
    </div>
  );
}
