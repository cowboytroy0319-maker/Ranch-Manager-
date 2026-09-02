import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/blog/what-does-each-herd-really-cost")({
  component: CostAllocationGuide,
});

function CostAllocationGuide() {
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

      <main className="container-x max-w-3xl py-12 sm:py-16">
        <nav className="text-sm text-stone-500">
          <Link to="/blog" className="hover:text-green-800">← Guides &amp; Resources</Link>
        </nav>
        <p className="eyebrow mt-6">Cost allocation · 5 min read</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-stone-900 sm:text-4xl">
          What Does Each Herd Really Cost? A Straightforward Cost-Allocation Guide
        </h1>

        <div className="mt-6 space-y-5 text-[17px] leading-relaxed text-stone-700">
          <p>
            Every rancher knows the feeling: you can tell you <em>spent</em> money this year, but
            when someone asks "what did that herd actually cost?" or "which tractor ate the most in
            repairs?" the honest answer is a shrug. Most of us keep enough records to file taxes, but
            not enough to know where the money really went. The fix isn't a better memory — it's a
            simple habit: label every cost as it happens.
          </p>

          <div className="rounded-xl border-l-4 border-green-700 bg-green-50 p-4">
            <p className="font-semibold text-green-900">
              The principle: assign every expense at the moment it happens.
            </p>
            <p className="mt-1 text-green-800">
              The trailer tire you buy at the shop, the tank of diesel in the feed truck, the bales
              dropped at the west pasture — each is cheap to record <em>then</em> and nearly
              impossible to reconstruct <em>later</em>. Log: what you paid, to whom, when, and —
              crucially — what it was for (which herd, which pasture, which truck, which job).
            </p>
          </div>

          <h2 className="pt-2 text-2xl font-bold text-stone-900">
            A complete cost record has a few fields that make the numbers actually answerable
          </h2>
          <ul className="list-disc space-y-2 pl-6">
            <li><strong>Which operation/entity</strong> it belongs to (if you run more than one).</li>
            <li><strong>Which species, herd, or animal</strong> it benefits (replacements vs. the cow herd vs. the horses).</li>
            <li><strong>Which pasture or piece of land</strong> it involves (fertilizer, fence repair, water).</li>
            <li><strong>Which equipment asset</strong> it hit (parts, repair labor, fuel).</li>
            <li><strong>Which job or activity</strong> (preg-checking, hay season, a fence project).</li>
            <li><strong>Date, vendor, and a category</strong> so you can roll the numbers up later.</li>
          </ul>

          <h2 className="pt-2 text-2xl font-bold text-stone-900">What the labels unlock</h2>
          <p>
            With a few hundred short entries a year, questions become arithmetic instead of
            archaeology:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li><strong>Cost per head</strong> — sum the year's expenses tagged to a herd, divide by head. "Is the cow herd self-sustaining?" has a number.</li>
            <li><strong>Cost per acre</strong> — land expenses (fertilizer, fence, water) ÷ grazed acres.</li>
            <li><strong>Cost per bale</strong> — raking, baling, twine, hauling ÷ bales. Custom-haying may beat owning the baler.</li>
            <li><strong>Cost per mile</strong> — fuel and maintenance on each vehicle.</li>
            <li><strong>Cost per equipment-hour</strong> — repair + fuel + depreciation ÷ hours run, deciding whether that old tractor is worth keeping.</li>
          </ul>

          <h2 className="pt-2 text-2xl font-bold text-stone-900">A small worked example</h2>
          <p>
            Tag a month's expenses: $600 hay to the north herd, $180 diesel in the feed truck, $340
            trailer brake repair, $120 fence wire for the river pasture. Ten minutes of tagging and
            you know the cow herd cost $600 in feed, the truck cost $180 in fuel (plus a share of the
            $340 repair), the river pasture cost $120. Repeat for a year and the patterns jump out.
          </p>

          <h2 className="pt-2 text-2xl font-bold text-stone-900">A tool can make this painless</h2>
          <p>
            If you'd rather this happen automatically than in a spreadsheet, some ranch management
            software logs costs at the point of action and tags them to herd, pasture, and equipment
            — that's how our own cost-allocation module works. But the habit itself — tag it now,
            know it later — works even on paper, because knowledge beats guessing every time.
          </p>
        </div>

        <div className="mt-10 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
          <p className="font-semibold">Put it to work</p>
          <p className="mt-1 text-green-800">
            Try the paper version — the free Cost-Per-Head Worksheet — or see the same math handled
            automatically in the live Expenses &amp; Cost Allocation module.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/worksheet" className="rounded-lg bg-green-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-900">
              Get the Cost-Per-Head Worksheet →
            </Link>
            <Link to="/expenses" className="rounded-lg border border-green-700 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
              See the live cost module →
            </Link>
            <Link to="/blog" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100">
              More guides
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
