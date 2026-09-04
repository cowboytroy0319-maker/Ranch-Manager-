// ============================================================================
// Ranch Manager Pro — Import placeholder (protected). Item 2 scope is
// templates ONLY — import is a LATER item and is deliberately NOT built here.
// This clearly-marked "coming soon" page keeps the onboarding choice honest:
// owners see that importing is planned, while nothing importable is exposed.
// ============================================================================
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { Card } from "~/components/ui";

export const Route = createFileRoute("/onboarding/import")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },
  component: ImportPage,
});

function ImportPage() {
  return (
    <AppShell
      badge="Import"
      eyebrow="Setup helpers"
      title="Import existing records"
      subtitle="Bringing your old spreadsheet into Ranch Manager Pro."
    >
      <Card className="border-amber-200 bg-amber-50/60">
        <div className="grid place-items-center text-4xl">📥</div>
        <h2 className="mt-3 text-center text-lg font-bold text-stone-900">Coming soon</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-stone-600">
          Importing your existing livestock, pasture, hay/feed, equipment, expense, and task records is on our
          roadmap. In the meantime, download the starter templates — they use the same fields the importer will
          accept, so you can fill them in now.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            to="/onboarding/templates"
            className="rounded-lg border border-green-700/40 bg-green-50 px-4 py-3 text-center text-sm font-semibold text-green-900 transition hover:bg-green-100"
          >
            ⬇ Download starter templates
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-center text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Skip — go to dashboard
          </Link>
        </div>
      </Card>
    </AppShell>
  );
}