import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/blog/what-do-i-need-to-do-today")({
  component: MorningRoutineGuide,
});

function MorningRoutineGuide() {
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
        <p className="eyebrow mt-6">Daily operations · 3 min read</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-stone-900 sm:text-4xl">
          What Do I Need to Do Today? A 5-Minute Morning Routine for the Ranch
        </h1>

        <div className="mt-6 space-y-5 text-[17px] leading-relaxed text-stone-700">
          <p>
            Most ranch days don't start with a plan — they start with a scramble: three notebooks, a
            fence-post keychain, a sticky note on the loader, and a vague sense you're forgetting
            something. The fix is a short, consistent morning scan. Five minutes, five questions, and
            you head to the barn knowing what today actually needs.
          </p>

          <div className="space-y-4 pt-1">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-lg font-bold text-green-900">1. Livestock health</h2>
              <p className="mt-1.5">
                Before chores, ask: is anyone on a follow-up (a vacc, a hoof trim, a vet call you owe
                them)? Do a headcount of the calves/lambs/foals. One quick walk now catches a problem
                while it's cheap to fix.
              </p>
            </section>
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-lg font-bold text-green-900">2. Pasture moves</h2>
              <p className="mt-1.5">
                What did you plan to move, and when? A day late on a rotation can mean overgrazed
                ground you'll pay for in August. Check grazing/rest days for each paddock; move the
                due ones or mark it so you don't forget by dusk.
              </p>
            </section>
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-lg font-bold text-green-900">3. Feed &amp; hay</h2>
              <p className="mt-1.5">
                What's the level in the barn and feed room? Run low on the wrong bale and you'll find
                out at feeding time in the rain. A thirty-second glance prevents the cold-sweat
                discovery an hour later.
              </p>
            </section>
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-lg font-bold text-green-900">4. Equipment</h2>
              <p className="mt-1.5">
                Any service due by hours, miles, or date? A tractor or trailer that's down is a day
                lost; fixing it on your schedule beats the breakdown's schedule.
              </p>
            </section>
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-lg font-bold text-green-900">5. Upcoming renewals</h2>
              <p className="mt-1.5">
                Tags, registrations, brand inspections, insurance. They don't feel urgent until you
                can't haul a trailer because a sticker lapsed. A standing note of what's due in the
                next 30 days clears them maybe once a month.
              </p>
            </section>
          </div>

          <h2 className="pt-2 text-2xl font-bold text-stone-900">The payoff is calm</h2>
          <p>
            You're not more organized — you've traded the scramble for a routine that moves the
            <em> remembering</em> out of your head and onto one place you can check in five minutes.
            Do the scan, write down the shortlist, and the day runs smoother than the notebook.
          </p>
        </div>

        <div className="mt-10 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
          <p className="font-semibold">Put it to work</p>
          <p className="mt-1 text-green-800">
            The Daily Operations dashboard is built around this exact question — livestock follow-ups,
            pasture moves, feed &amp; hay levels, equipment due for service, and upcoming renewals in
            one view. See it live.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/dashboard" className="rounded-lg bg-green-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-900">
              Open the Daily Ops dashboard →
            </Link>
            <Link to="/demo" className="rounded-lg border border-green-700 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
              Try the interactive demo
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
