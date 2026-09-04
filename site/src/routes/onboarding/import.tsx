// ============================================================================
// Ranch Manager Pro — Livestock CSV import flow (protected route, live
// Postgres, owner-only). Turns the old "coming soon" placeholder into the real
// staged import surface (Item 3, owner-approved private beta):
//
//   1. Choose file — .csv only, ≤1 MB; client-side quick checks + friendly
//      errors; shows the chosen filename.
//   2. Map columns — smart-guess defaults (case-insensitive header matching),
//      every app field selectable, "— ignore —" for unknown columns; the two
//      required fields (tag_number, species) are enforced before continuing.
//   3. Review — every row with a status (ready/missing/invalid/dup-in-file/
//      dup-existing), reasons, and a toggle to EXCLUDE rows from the import;
//      count summary; nothing has been written yet (preview-before-write).
//   4. Confirm — explicit "Import N animals"; if any duplicate rows remain
//      (dup-in-file/dup-existing) a checkbox acknowledgment is required
//      ("will be skipped — import the rest anyway"); a same-fingerprint prior
//      import also requires its own acknowledgment ("already imported — import
//      anyway?"). Never auto-skip, never silent.
//   5. Result — imported / skipped-by-status / excluded counts + reasons and
//      a "Done — go to livestock" action.
//
// Phone-first (single column, full-width controls, large touch targets), like
// the rest of the app. The server endpoints re-validate EVERYTHING at commit
// (see src/server/importLivestock.ts); this UI never writes by itself.
// ============================================================================
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { Badge, Card, CardTitle, MobilePrimaryButton } from "~/components/ui";
import { importLivestockCommit, parseLivestockCsv } from "~/server/importLivestock";
import {
  IMPORT_FIELD_LABEL,
  IMPORT_MAX_BYTES,
  IMPORT_ROW_STATUSES,
  type ImportColumnMapping,
  type ImportField,
  type ImportReviewRow,
  type LivestockImportResult,
  type LivestockImportSession,
} from "~/types/importLivestock";

export const Route = createFileRoute("/onboarding/import")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },
  component: ImportPage,
});

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

const btnCls =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const primaryBtn = `${btnCls} bg-green-800 text-white hover:bg-green-900 active:bg-green-950 disabled:bg-green-300`;
const outlineBtn = `${btnCls} border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 active:bg-stone-100`;

const statusBadgeTone: Record<string, "green" | "amber" | "red" | "stone" | "blue"> = {
  ready: "green",
  missing: "amber",
  invalid: "red",
  "dup-in-file": "red",
  "dup-existing": "red",
  excluded: "stone",
};

const statusBadgeLabel: Record<string, string> = {
  ready: "ready",
  missing: "missing field",
  invalid: "invalid value",
  "dup-in-file": "duplicate in file",
  "dup-existing": "already in ranch",
  excluded: "excluded",
};

/** status → [text, tone] summary helper shared by the Confirm + Result steps. */
function statusCounts(rows: ImportReviewRow[]) {
  const counts: Record<string, number> = {};
  for (const s of IMPORT_ROW_STATUSES) counts[s] = 0;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<"file" | "map" | "review" | "confirm" | "result">("file");
  const [session, setSession] = useState<LivestockImportSession | null>(null);
  const [result, setResult] = useState<LivestockImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [ackDups, setAckDups] = useState(false);
  const [ackFingerprint, setAckFingerprint] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset acknowledgment state whenever the session changes (each parsed file
  // is a fresh decision).
  useEffect(() => {
    if (session) {
      setAckDups(false);
      setAckFingerprint(false);
    }
  }, [session?.fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = session?.rows ?? [];
  const counts = statusCounts(rows);
  const dupRows = rows.filter((r) => r.status === "dup-in-file" || r.status === "dup-existing");
  const readyCount = counts.ready ?? 0;
  const hasPrevious = session?.prevImport != null;

  const readFileText = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsText(f, "utf-8");
    });

  const handleFile = async (f: File | null) => {
    setError(null);
    setResult(null);
    setStep("file");
    if (!f) return;
    setFile(f);
    // Client-side quick checks mirror the server's allowlist (the server
    // re-checks everything — these just fail fast with friendly copy).
    const name = f.name.toLowerCase();
    const isCsv = name.endsWith(".csv") || f.type === "text/csv" || f.type === "application/vnd.ms-excel";
    if (!isCsv) {
      setError("That doesn't look like a CSV file. Livestock import accepts plain .csv files (text/csv).");
      return;
    }
    if (f.size > IMPORT_MAX_BYTES) {
      setError(`This file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 1 MB. Trim it down and try again.`);
      return;
    }
    setBusy(true);
    try {
      const text = await readFileText(f);
      const res = await parseLivestockCsv({
        data: { name: f.name, text, bytes: f.size, mime: f.type },
      });
      if (res.error) {
        setError(res.error);
        setSession(null);
        return;
      }
      setSession(res);
      setMappingDirty(false);
      setExcluded(new Set());
      setStep("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const updateMapping = (idx: number, field: ImportField | null) => {
    if (!session) return;
    setMappingDirty(true);
    setSession({
      ...session,
      mapping: session.mapping.map((m, i) => (i === idx ? { ...m, field } : m)),
    });
  };

  const goReview = () => {
    if (!session) return;
    const mapped = session.mapping.filter((m) => m.field !== null);
    const dupField = mapped.find(
      (m, i) => m.field !== null && mapped.findIndex((x) => x.field === m.field) !== i
    );
    const missingTag = !mapped.some((m) => m.field === "tag_number");
    const missingSpecies = !mapped.some((m) => m.field === "species");
    setError(null);
    if (dupField?.field) {
      setError(`The "${dupField.field}" field is mapped to more than one column — each app field can only come from one CSV column.`);
      return;
    }
    if (missingTag) {
      setError("Tag / animal ID must be mapped to a column — it is required for every row.");
      return;
    }
    if (missingSpecies) {
      setError("Species must be mapped to a column — it is required for every row.");
      return;
    }
    setStep("review");
  };

  const toggleExcluded = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const effectiveReady = rows.filter((r) => r.status === "ready" && !excluded.has(r.index)).length;

  const handleCommit = async () => {
    if (!session || !file) return;
    setBusy(true);
    setError(null);
    try {
      // Re-read the SAME file bytes (the server re-validates from them).
      const text = await readFileText(file);
      const res = await importLivestockCommit({
        data: {
          csvText: text,
          mapping: session.mapping,
          excludedIndices: [...excluded],
          accepted: ackFingerprint,
          filename: session.filename,
        },
      });
      setResult(res);
      setStep("result");
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — no rows were written.");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setSession(null);
    setResult(null);
    setFile(null);
    setError(null);
    setExcluded(new Set());
    setAckDups(false);
    setAckFingerprint(false);
    setMappingDirty(false);
    setStep("file");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <AppShell
      badge="Import"
      eyebrow="Livestock"
      title="Import livestock from CSV"
      subtitle="Bring your herd in from a spreadsheet — preview every row before a single record is written. Owner-only."
    >
      <div className="space-y-4">
        {/* Step indicator */}
        <Card className="border-green-200 bg-green-50/50">
          <div className="flex items-center justify-between text-xs font-semibold text-green-900">
            <StepDot n={1} label="File" active={step === "file"} done={step !== "file"} />
            <StepDot n={2} label="Map columns" active={step === "map"} done={["review", "confirm", "result"].includes(step)} />
            <StepDot n={3} label="Review" active={step === "review"} done={["confirm", "result"].includes(step)} />
            <StepDot n={4} label="Import" active={step === "confirm"} done={step === "result"} />
          </div>
        </Card>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Step 1 — choose file */}
        {step === "file" && (
          <Card>
            <CardTitle
              title="Choose your CSV file"
              sub="Plain text .csv only — no macros, no formulas, no Excel binaries. Up to 1 MB and 2,000 animals per file."
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,application/vnd.ms-excel"
              className="block w-full cursor-pointer rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-700 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-green-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-green-700"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="mt-2 text-sm text-stone-600">
                Selected: <span className="font-semibold text-stone-800">{file.name}</span> ({Math.round(file.size / 1024)} KB)
              </p>
            )}
            {busy && <p className="mt-2 text-sm text-green-800">Reading and checking your file…</p>}
            <div className="mt-4 flex flex-col gap-2">
              <Link to="/onboarding/templates" className={outlineBtn}>
                ⬇ Not sure of the format? Download the starter template
              </Link>
              <Link to="/onboarding" className={outlineBtn}>
                ← Back to setup
              </Link>
            </div>
          </Card>
        )}

        {/* Step 2 — map columns */}
        {step === "map" && session && (
          <Card>
            <CardTitle
              title="Match your columns"
              sub={`${session.filename} — we guessed the mapping from your header row. Fix anything that looks off; unknown columns can be ignored.`}
            />
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Required fields: <b>tag_number</b> (ear tag / animal ID) and <b>species</b> (cattle, horse, goat, sheep). Every other
              column is optional.
            </p>
            <div className="space-y-2">
              {session.headers.map((h, i) => {
                const m = session.mapping[i];
                return (
                  <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-stone-200 bg-white p-3 sm:flex-row sm:items-center">
                    <span className="shrink-0 font-mono text-xs font-semibold text-stone-700 sm:w-44 sm:truncate">{h || "(blank column)"}</span>
                    <select
                      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-green-700 sm:w-auto sm:flex-1"
                      value={m.field ?? ""}
                      onChange={(e) => updateMapping(i, (e.target.value || null) as ImportField | null)}
                    >
                      <option value="">— ignore —</option>
                      {importAllFields.map((f) => (
                        <option key={f} value={f}>
                          {IMPORT_FIELD_LABEL[f]}
                        </option>
                      ))}
                    </select>
                    {m.field && <Badge tone="green">{IMPORT_FIELD_LABEL[m.field]}</Badge>}
                  </div>
                );
              })}
              {session.headers.length === 0 && (
                <p className="text-sm text-stone-500">No columns found in the header row.</p>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <MobilePrimaryButton className="flex-1" onClick={goReview} disabled={busy || session.headers.length === 0}>
                {mappingDirty || true ? "Review all rows →" : "Review all rows →"}
              </MobilePrimaryButton>
              <button type="button" onClick={() => setStep("file")} className={outlineBtn}>
                ← Choose a different file
              </button>
            </div>
          </Card>
        )}

        {/* Step 3 — review */}
        {step === "review" && session && (
          <Card>
            <CardTitle
              title="Review before importing"
              sub="Nothing has been written yet — this is a preview. Rows marked duplicate will be skipped (not canceled); toggle off any row you want to leave out."
            />
            <SummaryStrip counts={counts} total={rows.length} excluded={excluded.size} />
            {dupRows.length > 0 && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ {dupRows.length} row{dupRows.length === 1 ? "" : "s"} ha{dupRows.length === 1 ? "s" : "ve"} a duplicate tag — these will be
                skipped and counted, never silently imported.
              </p>
            )}
            <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-xl border border-stone-100 p-2">
              {rows.map((r) => (
                <div
                  key={r.index}
                  className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                    excluded.has(r.index) ? "border-stone-200 bg-stone-50 opacity-60" : "border-stone-100 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Exclude row ${r.index + 1}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-green-800"
                    checked={excluded.has(r.index)}
                    onChange={() => toggleExcluded(r.index)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-stone-400">#{r.index + 1}</span>
                      <span className="font-semibold text-stone-800">{r.tag_number ?? "— no tag —"}</span>
                      <Badge tone={statusBadgeTone[r.status] ?? "stone"}>{statusBadgeLabel[r.status] ?? r.status}</Badge>
                    </div>
                    {r.status !== "ready" && <p className="mt-0.5 text-xs text-stone-600">{r.reason}</p>}
                    <p className="mt-1 truncate font-mono text-[11px] text-stone-400">{displayLine(r)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => setStep("map")} className={outlineBtn}>
                ← Fix column mapping
              </button>
              <MobilePrimaryButton className="flex-1" onClick={() => setStep("confirm")} disabled={effectiveReady === 0}>
                {effectiveReady === 0 ? "Nothing to import" : `Continue — import ${effectiveReady} animal${effectiveReady === 1 ? "" : "s"} →`}
              </MobilePrimaryButton>
            </div>
          </Card>
        )}

        {/* Step 4 — final confirm */}
        {step === "confirm" && session && (
          <Card>
            <CardTitle
              title="Final confirmation"
              sub="Once you confirm, the import runs in one transaction — either every ready row lands or none do."
            />
            <SummaryStrip counts={counts} total={rows.length} excluded={excluded.size} />
            <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              <b>{effectiveReady} animal{effectiveReady === 1 ? "" : "s"}</b> will be imported.
              {dupRows.length > 0 && (
                <span className="text-amber-800">
                  {" "}
                  {dupRows.length} duplicate-tag row{dupRows.length === 1 ? "" : "s"} will be skipped.
                </span>
              )}
              {excluded.size > 0 && (
                <span className="text-stone-600"> {excluded.size} excluded row{excluded.size === 1 ? "" : "s"} will be left out.</span>
              )}
            </div>
            {dupRows.length > 0 && (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-amber-700"
                  checked={ackDups}
                  onChange={(e) => setAckDups(e.target.checked)}
                />
                <span>
                  I understand — <b>{dupRows.length} row{dupRows.length === 1 ? "" : "s"} with duplicate tag{dupRows.length === 1 ? "" : "s"}</b> will be
                  skipped. Import the rest anyway.
                </span>
              </label>
            )}
            {hasPrevious && session.prevImport && (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-red-700"
                  checked={ackFingerprint}
                  onChange={(e) => setAckFingerprint(e.target.checked)}
                />
                <span>
                  This file looks like it was already imported on{" "}
                  <b>{formatDate(session.prevImport.createdAt)}</b> ({session.prevImport.importedRows} animals). I still want to import it
                  anyway.
                </span>
              </label>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => setStep("review")} className={outlineBtn}>
                ← Back to review
              </button>
              <MobilePrimaryButton
                className="flex-1 bg-green-800 text-white hover:bg-green-900"
                disabled={
                  busy ||
                  effectiveReady === 0 ||
                  (dupRows.length > 0 && !ackDups) ||
                  (hasPrevious && !ackFingerprint)
                }
                onClick={() => void handleCommit()}
              >
                {busy ? "Importing…" : `Import ${effectiveReady} animal${effectiveReady === 1 ? "" : "s"} now`}
              </MobilePrimaryButton>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              All-or-nothing: if anything goes wrong mid-import, every row is rolled back — nothing partial persists.
            </p>
          </Card>
        )}

        {/* Step 5 — result */}
        {step === "result" && result && (
          <Card className="border-green-200 bg-green-50/50">
            <div className="grid place-items-center text-4xl">{result.ok ? "🎉" : "😮"}</div>
            <h2 className="mt-2 text-center text-lg font-bold text-stone-900">
              {result.ok
                ? `Done — ${result.imported ?? 0} animal${(result.imported ?? 0) === 1 ? "" : "s"} imported`
                : "Import didn't complete"}
            </h2>
            {result.ok ? (
              <>
                <div className="mx-auto mt-3 max-w-md space-y-1 rounded-xl bg-white p-3 text-sm text-stone-700">
                  <p>
                    <b>Imported:</b> {result.imported ?? 0}
                  </p>
                  <p>
                    <b>Skipped:</b> {(result.skipped ?? 0) + (result.excluded ?? 0)} (
                    {(result.skipped ?? 0) > 0 ? `${result.skipped} duplicate/issue` : ""}
                    {(result.skipped ?? 0) > 0 && (result.excluded ?? 0) > 0 ? " · " : ""}
                    {(result.excluded ?? 0) > 0 ? `${result.excluded} you excluded` : ""}
                    {(result.skipped ?? 0) === 0 && (result.excluded ?? 0) === 0 ? "none" : ""})
                  </p>
                  <p>
                    <b>Total rows in file:</b> {result.total ?? 0}
                  </p>
                  {result.previous && (
                    <p className="text-xs text-stone-500">
                      Note: the same file was imported before ({formatDate(result.previous.createdAt)}).
                    </p>
                  )}
                </div>
                <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 sm:flex-row">
                  <Link to="/livestock" className={`${btnCls} flex-1 bg-green-800 text-white hover:bg-green-900`}>
                    🐄 Done — go to livestock
                  </Link>
                  <button type="button" onClick={resetAll} className={`${outlineBtn} flex-1`}>
                    Import another file
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mx-auto mt-2 max-w-md text-center text-sm text-red-700">{result.error ?? "Something went wrong."}</p>
                <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => setStep("confirm")} className={`${outlineBtn} flex-1`}>
                    ← Try again
                  </button>
                  <Link to="/onboarding" className={`${outlineBtn} flex-1`}>
                    Back to setup
                  </Link>
                </div>
              </>
            )}
          </Card>
        )}

        <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-sm text-stone-600">Nothing is written to your herd until you confirm.</p>
          <Link to="/dashboard" className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100">
            Skip for now
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

const importAllFields: ImportField[] = [
  "tag_number",
  "species",
  "name",
  "sex",
  "breed",
  "birth_date",
  "acquisition_date",
  "status",
  "pasture",
  "notes",
];

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
          done ? "bg-green-800 text-white" : active ? "bg-green-200 text-green-900 ring-2 ring-green-700" : "bg-stone-200 text-stone-500"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function SummaryStrip({ counts, total, excluded }: { counts: Record<string, number>; total: number; excluded: number }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      <Badge tone="green">{counts.ready ?? 0} ready</Badge>
      <Badge tone="amber">{(counts.missing ?? 0) + (counts.invalid ?? 0)} can't import</Badge>
      <Badge tone="red">{(counts["dup-in-file"] ?? 0) + (counts["dup-existing"] ?? 0)} duplicate</Badge>
      <Badge tone="stone">{excluded} excluded</Badge>
      <Badge tone="stone">{total} total</Badge>
    </div>
  );
}

function displayLine(r: ImportReviewRow): string {
  const v = r.values;
  return [v.tag_number, v.species, v.name, v.sex, v.breed, v.birth_date, v.acquisition_date, v.status, v.pasture, v.notes]
    .map((x) => x ?? "")
    .join(", ");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}