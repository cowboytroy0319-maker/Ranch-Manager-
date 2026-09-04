// ============================================================================
// Ranch Manager Pro — Starter templates page (protected). Lists all six
// downloadable CSV templates with their plain-language field legends and
// downloads them via a real Blob + anchor flow (authenticated server fn).
// Item 2 scope is templates ONLY — there is no import parsing here.
// ============================================================================
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { Badge, Card, CardTitle } from "~/components/ui";
import { downloadTemplateCSV } from "~/components/onboarding/download";
import { markTemplatesDownloaded } from "~/server/onboarding";
import { TEMPLATES, type TemplateSlug } from "~/types/onboarding";

export const Route = createFileRoute("/onboarding/templates")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },
  component: TemplatesPage,
});

function TemplatesPage() {
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (slug: TemplateSlug) => {
    setError(null);
    const res = await downloadTemplateCSV(slug);
    if (!res.ok) {
      setError(res.error ?? "Could not download the template.");
      return;
    }
    setDownloaded((d) => (d.includes(slug) ? d : [...d, slug]));
    try {
      await markTemplatesDownloaded();
    } catch {
      /* non-blocking — the download still worked */
    }
  };

  return (
    <AppShell
      badge="Templates"
      eyebrow="Setup helpers"
      title="Download starter templates"
      subtitle="CSV files with the exact fields the app accepts — header row, one example row, and a plain-language legend for every column. Open them in Excel, Numbers, or Google Sheets."
    >
      <div className="space-y-4">
        <Card className="border-green-200 bg-green-50/50">
          <CardTitle
            title="How this works"
            sub="Each file is plain text — no macros, no formulas, no links. If you have existing records in a spreadsheet, copy them under the header row (replace the example row) and import will be available later."
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="green">6 templates</Badge>
            <Badge tone="stone">CSV text</Badge>
            <Badge tone="stone">No macros</Badge>
          </div>
        </Card>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(Object.keys(TEMPLATES) as TemplateSlug[]).map((slug) => {
            const t = TEMPLATES[slug];
            const got = downloaded.includes(slug);
            return (
              <Card key={slug} className="flex flex-col">
                <CardTitle title={`${t.emoji} ${t.title}`} sub={t.description} />
                <ul className="mt-3 space-y-1 text-sm text-stone-600">
                  {t.fields.map((f) => (
                    <li key={f.name} className="flex gap-2">
                      <span className="font-mono text-xs font-semibold text-green-800">{f.name}</span>
                      <span className="min-w-0 flex-1">
                        {f.legend} {f.required && <Badge tone="red">required</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void handleDownload(slug)}
                  className="mt-4 w-full rounded-lg border border-green-700/40 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900 transition hover:bg-green-100 active:bg-green-200"
                >
                  {got ? "✓ Downloaded — ranch-" + slug + ".csv" : `⬇ Download ${t.title} CSV`}
                </button>
              </Card>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-sm text-stone-600">Downloading any template counts as one setup step.</p>
          <Link to="/onboarding" className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100">
            ← Back to setup
          </Link>
        </div>
      </div>
    </AppShell>
  );
}