// ============================================================================
// /preview-status — the owner-visible proof of WHICH database the running
// preview deployment is using.
//
// Server-rendered, public, and deliberately narrow: environment mode and which
// variable supplied it, the preview database identity (user@host:port/dbname —
// never a password), whether the preview target is the production target, the
// guard verdict, migrations applied, and the branch + commit the preview tree
// was synced from. Nothing else is exposed.
//
// It must be readable on a phone: single column, no wide tables, no horizontal
// scrolling.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { getPreviewStatus } from "~/server/previewStatus";

export const Route = createFileRoute("/preview-status")({
  loader: () => getPreviewStatus(),
  component: PreviewStatusPage,
});

function Row({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-800"
      : tone === "bad"
        ? "text-red-700"
        : "text-stone-800";
  return (
    <div className="border-b border-stone-200 py-3 last:border-b-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </div>
      <div className={`mt-0.5 break-words text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function PreviewStatusPage() {
  const s = Route.useLoaderData();
  const refused = s.guard.state === "refused";
  const isPreview = s.mode === "preview";

  return (
    <div className="min-h-dvh bg-stone-100 px-4 py-6 sm:px-6 sm:py-10">
      <main className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-sm">
        <header
          className={`px-5 py-4 ${refused ? "bg-red-700" : isPreview ? "bg-green-800" : "bg-stone-800"}`}
        >
          <h1 className="text-lg font-bold text-white">Preview status</h1>
          <p className="mt-1 text-xs font-medium text-white/85">
            {refused
              ? "Guard refused this configuration — no queries are being served."
              : isPreview
                ? "This deployment is running the PREVIEW environment."
                : "This deployment is NOT in preview mode."}
          </p>
        </header>

        <div className="px-5 py-2">
          <h2 className="pt-3 text-[11px] font-bold uppercase tracking-wide text-stone-400">
            Environment
          </h2>
          <Row
            label="Environment mode"
            value={s.mode}
            tone={refused ? "bad" : isPreview ? "good" : "normal"}
          />
          <Row label="Mode supplied by" value={s.modeSource} />
          <Row label="Connection string from" value={s.urlSource} />
          <Row
            label="Preview expected flag"
            value={s.previewEnvExpected ? "set (PREVIEW_ENV_EXPECTED)" : "not set"}
          />

          <h2 className="pt-5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
            Database
          </h2>
          <Row
            label="Preview database (user@host:port/db)"
            value={s.previewDatabase ?? "— not resolved —"}
            tone={s.previewDatabase ? "good" : "bad"}
          />
          <Row
            label="Production host"
            value={s.productionHost ?? "— not set —"}
          />
          <Row
            label="Preview target = production target?"
            value={s.equalsProductionTarget ? "YES — refused" : "no"}
            tone={s.equalsProductionTarget ? "bad" : "good"}
          />
          <Row
            label="Guard state"
            value={refused ? `REFUSED — ${s.guard.rule ?? "unknown rule"}` : "pass"}
            tone={refused ? "bad" : "good"}
          />
          {refused && s.guard.detail ? (
            <Row label="Refusal detail" value={s.guard.detail} tone="bad" />
          ) : null}

          <h2 className="pt-5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
            Migrations
          </h2>
          <Row
            label="Migrations applied"
            value={s.migrations.count === null ? "unavailable" : String(s.migrations.count)}
            tone={s.migrations.count === null ? "bad" : "good"}
          />
          <Row label="Latest migration" value={s.migrations.latest ?? s.migrations.note ?? "none"} />

          <h2 className="pt-5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
            Deployed tree
          </h2>
          <Row label="Branch" value={s.deployment.branch ?? "unknown"} />
          <Row label="Commit" value={s.deployment.commit ?? "unknown"} />
          <Row label="Synced at" value={s.deployment.syncedAt ?? "unknown"} />
          <Row label="Deployment marker" value={s.deployment.marker ?? "unknown"} />
          <div className="py-3 text-[11px] text-stone-400">
            Passwords, connection strings, keys and data are never shown on this page.
          </div>
        </div>
      </main>
    </div>
  );
}
