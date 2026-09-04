// ============================================================================
// Ranch Manager Pro — Onboarding / setup flow (protected route, live Postgres).
// A newly registered owner lands here (register routes to /onboarding?new),
// existing users who skipped or never finished see it too (dashboard progress
// card + banner links here). Mobile-first: one column, full-width inputs,
// large touch targets, numeric keyboard for acres. The owner can edit every
// field later from this page.
//
//   • NEVER traps the user: "Skip for now" / "Finish later" and the bottom nav
//     are always visible; skipping keeps the dashboard fully usable.
//   • Offers three clear choices: Start fresh / Import existing records /
//     Download templates. Import is a later item — the card links to
//     /onboarding/import, a clearly-marked "coming soon" placeholder page
//     (no import functionality is built).
//   • Name prefills from registration (operations.name). Location, operation
//     type, acres, and primary species are optional and editable.
// ============================================================================
import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { Badge, Card, CardTitle } from "~/components/ui";
import { MobilePrimaryButton } from "~/components/ui";
import {
  finishOnboarding,
  getOnboarding,
  renameOperation,
  saveOnboarding,
} from "~/server/onboarding";
import { downloadTemplateCSV } from "~/components/onboarding/download";
import {
  OPERATION_TYPES,
  OPERATION_TYPE_LABEL,
  PRIMARY_SPECIES,
  TEMPLATES,
  type OnboardingData,
  type OperationType,
  type TemplateSlug,
} from "~/types/onboarding";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },
  loader: () => getOnboarding(),
  component: OnboardingPage,
});

const selectCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 placeholder-stone-400 focus:border-green-600 focus:ring-2 focus:ring-green-600/30 focus:outline-none";
const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 placeholder-stone-400 focus:border-green-600 focus:ring-2 focus:ring-green-600/30 focus:outline-none";

/** Progress = 1 (name) + completed checklist steps, mirroring the server. */
function progressOf(data: OnboardingData): { done: number; total: number; label: string } {
  const total = 5;
  const missing = data.setupDone ? 0 : (data.missingSteps?.length ?? 4);
  const done = total - missing;
  return { done, total, label: `${done} of ${total} steps done` };
}

function OnboardingPage() {
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [data, setData] = useState<OnboardingData>(initial);
  const [name, setName] = useState(initial.operationName ?? "");
  const [location, setLocation] = useState(initial.profile?.location ?? "");
  const [opType, setOpType] = useState<OperationType | "">(initial.profile?.operation_type ?? "");
  const [acres, setAcres] = useState(initial.profile?.acres != null ? String(initial.profile.acres) : "");
  const [species, setSpecies] = useState(initial.profile?.primary_species ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);

  const progress = useMemo(() => progressOf(data), [data]);

  // Keep local fields in sync whenever the loader/state changes.
  useEffect(() => {
    setName(data.operationName ?? "");
    setLocation(data.profile?.location ?? "");
    setOpType(data.profile?.operation_type ?? "");
    setAcres(data.profile?.acres != null ? String(data.profile.acres) : "");
    setSpecies(data.profile?.primary_species ?? "");
  }, [data.operationId, data.profile?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    const next = await getOnboarding();
    setData(next);
  };

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
      await refresh();
      await router.invalidate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    // If the name changed, rename the operation row first (owner-scoped).
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== (data.operationName ?? "")) {
      const renameRes = await renameOperation({ data: { name: trimmedName } });
      if (!renameRes.ok) {
        setError((renameRes as { error?: string }).error ?? "Could not save the operation name.");
        return;
      }
    }
    await run(async () => {
      const res = await saveOnboarding({
        data: {
          location: location || null,
          operation_type: opType || null,
          acres: acres ? Number(acres) : null,
          primary_species: species || null,
        },
      });
      if (!res.ok) throw new Error((res as { error?: string }).error ?? "Could not save your setup.");
    });
  };

  const handleFinish = async () => {
    setFinishing(true);
    setError(null);
    try {
      // Save whatever is filled first (so a partial setup is still persisted).
      const saveRes = await saveOnboarding({
        data: {
          location: location || null,
          operation_type: opType || null,
          acres: acres ? Number(acres) : null,
          primary_species: species || null,
        },
      });
      if (!saveRes.ok) throw new Error((saveRes as { error?: string }).error ?? "Could not save your setup.");
      const res = await finishOnboarding();
      if (!res.ok) throw new Error((res as { error?: string }).error ?? "Could not finish setup.");
      await refresh();
      void navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setFinishing(false);
    }
  };

  const handleDownload = async (slug: keyof typeof TEMPLATES) => {
    const res = await downloadTemplateCSV(slug as TemplateSlug);
    if (!res.ok) {
      setError(res.error ?? "Could not download the template.");
      return;
    }
    setDownloaded((d) => (d.includes(slug) ? d : [...d, slug]));
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
    await refresh();
  };

  // ----------------------------- view -----------------------------
  return (
    <AppShell badge="Onboarding" eyebrow="Set up your operation" title="Let's set up your ranch" subtitle={`${data.operationName ?? "Your operation"} — 5 quick steps, save anytime, skip if you're ready to work.`}>
      {data.configured === false ? (
        <Card>
          <CardTitle title="Database not configured" sub="Setup will save once the site is connected to its database." />
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Progress */}
          <Card className="border-green-200 bg-green-50/50">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-green-900">Ranch setup {progress.label}</p>
              <Badge tone={data.setupDone ? "green" : "amber"}>{data.setupDone ? "Complete" : "In progress"}</Badge>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full rounded-full bg-green-700 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-green-800">
              {data.setupDone
                ? "Everything set — you can come back to edit any of this any time."
                : "You can save now and keep working; this card stays on your dashboard until setup is done."}
            </p>
          </Card>

          {/* How to start */}
          <Card>
            <CardTitle title="How do you want to start?" sub="You can do any of these — in any order, any time." />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Link
                to="/onboarding/templates"
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-green-700/40 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900 transition hover:border-green-700 hover:bg-green-100 active:bg-green-200"
              >
                ⬇️ Download templates
              </Link>
              <Link
                to="/onboarding/import"
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-600 transition hover:border-stone-300 hover:bg-stone-100"
              >
                📥 Import existing records <span className="text-xs font-normal text-amber-700">(coming soon)</span>
              </Link>
              <Link
                to="/dashboard"
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                🚜 Start fresh — go to dashboard
              </Link>
            </div>
          </Card>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Setup form */}
          <Card>
            <CardTitle title="About your operation" sub="All optional — skip anything you don't know yet and save." />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
              className="mt-3 space-y-4"
            >
              <div>
                <label htmlFor="onb-name" className="mb-1 block text-sm font-medium text-stone-700">
                  Ranch / operation name
                </label>
                <input id="onb-name" className={inputCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T Bar T Ranch" />
                <p className="mt-1 text-xs text-stone-500">Set at registration — edit here anytime.</p>
              </div>
              <div>
                <label htmlFor="onb-location" className="mb-1 block text-sm font-medium text-stone-700">
                  Location <span className="text-stone-400">(optional)</span>
                </label>
                <input id="onb-location" className={inputCls} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lane County, OR" />
              </div>
              <div>
                <label htmlFor="onb-type" className="mb-1 block text-sm font-medium text-stone-700">
                  Primary operation type <span className="text-stone-400">(optional)</span>
                </label>
                <select id="onb-type" className={selectCls} value={opType} onChange={(e) => setOpType(e.target.value as OperationType | "")}>
                  <option value="">Choose one…</option>
                  {OPERATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {OPERATION_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="onb-acres" className="mb-1 block text-sm font-medium text-stone-700">
                  Approximate ranch / farm acres <span className="text-stone-400">(optional)</span>
                </label>
                <input
                  id="onb-acres"
                  className={inputCls}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={acres}
                  onChange={(e) => setAcres(e.target.value)}
                  placeholder="e.g. 1200.5"
                />
                <p className="mt-1 text-xs text-stone-500">Positive number — the numeric keypad opens on phones.</p>
              </div>
              <div>
                <label htmlFor="onb-species" className="mb-1 block text-sm font-medium text-stone-700">
                  Primary species / focus <span className="text-stone-400">(optional)</span>
                </label>
                <input id="onb-species" className={inputCls} maxLength={80} list="onb-species-list" value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="e.g. cattle, horses, goats, sheep…" />
                <datalist id="onb-species-list">
                  {PRIMARY_SPECIES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <MobilePrimaryButton type="submit" disabled={busy || finishing} className="flex-1">
                  {busy ? "Saving…" : "Save setup"}
                </MobilePrimaryButton>
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={busy || finishing}
                  className="w-full rounded-lg border border-green-700 px-4 py-3 font-semibold text-green-800 transition hover:bg-green-50 active:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:flex-1"
                >
                  {finishing ? "Finishing…" : "I'm done — go to dashboard"}
                </button>
              </div>
            </form>
          </Card>

          {/* Templates */}
          <Card>
            <CardTitle title="Starter templates" sub="Plain CSV files with the exact fields the app accepts — open them in any spreadsheet. Downloading counts toward your setup progress." />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((slug) => {
                const t = TEMPLATES[slug];
                const got = downloaded.includes(slug as keyof typeof TEMPLATES);
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => void handleDownload(slug)}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-stone-800 transition hover:border-green-700 hover:bg-green-50 active:bg-green-100"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-lg">{t.emoji}</span>
                      <span className="truncate">{t.title}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${got ? "text-green-700" : "text-stone-400"}`}>
                      {got ? "✓ downloaded" : "⬇ csv"}
                    </span>
                  </button>
                );
              })}
            </div>
            <Link to="/onboarding/templates" className="mt-2 inline-block text-sm font-medium text-green-700 hover:underline">
              View all templates &amp; field guides →
            </Link>
          </Card>

          {/* Never trap */}
          <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-sm text-stone-600">Not now? Keep using the app — come back any time.</p>
            <Link to="/dashboard" className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100">
              Skip for now
            </Link>
          </div>

          {savedFlash && <p className="text-center text-sm text-green-700">✓ Saved — setup is {progress.label}.</p>}
        </div>
      )}
    </AppShell>
  );
}