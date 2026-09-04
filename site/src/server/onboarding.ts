// ============================================================================
// Ranch Manager Pro — Onboarding server functions + downloadable CSV template
// generators. The ONLY place that talks to the database for onboarding data
// (except the auth cores, which create the operation at registration).
//
//   • All reads/writes are scoped by requireAuth() → auth.operationId and the
//     owner membership; there is NO Default-Operation fallback.
//   • Data/security: parameterized queries only; nothing customer-owned is
//     ever selected by "first operation" or "default".
//   • Templates are generated in pure functions (buildTemplateCsv) from the
//     shared enum types (src/types/onboarding.ts) so test assertions can
//     verify template content against the exact accepted values the app uses.
//   • The injectable *Core functions are the exact SQL shapes the public
//     createServerFn handlers run (requireAuth → core), so tests can exercise
//     operation scoping + isolation against the local test DB without a
//     request context (same pattern as authServer.registerCore).
//   • Item 2 scope is templates ONLY: no import/export parsing anywhere. The
//     onboarding UI links "Import existing records" to a clearly-marked
//     "coming soon" placeholder (route /onboarding/import), never to a
//     working import flow.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./authServer";
import { isDatabaseConfigured, sql } from "~/db";
import {
  OPERATION_TYPES,
  SETUP_STEP_LABEL,
  TEMPLATES,
  type OnboardingData,
  type OnboardingInput,
  type OperationType,
  type SetupStepKey,
  type TemplateSlug,
} from "~/types/onboarding";

export type OnboardingDb = ReturnType<typeof sql>;

// ---------------------------------------------------------------------------
// Pure setup-checklist helpers (unit-testable without a database)
// ---------------------------------------------------------------------------

/**
 * The 5 required setup steps (see docs/ONBOARDING_TEMPLATES.md). Step 1
 * (name) is satisfied by operations.name (always set at registration); the
 * profile steps count when their column is filled; "templates" counts when
 * templates_downloaded is true.
 */
export function setupStepKeys(profile: {
  operation_type: OperationType | null;
  acres: number | null;
  primary_species: string | null;
  templates_downloaded: boolean;
}): SetupStepKey[] {
  const missing: SetupStepKey[] = [];
  if (!profile.operation_type) missing.push("operation_type");
  if (profile.acres === null || Number(profile.acres) <= 0) missing.push("acres");
  const primary = profile.primary_species?.trim() ?? "";
  if (!primary) missing.push("primary_species");
  if (!profile.templates_downloaded) missing.push("templates");
  return missing;
}

export function setupProgress(missing: SetupStepKey[]): { stepsDone: number; stepsTotal: number; done: boolean } {
  const stepsTotal = Object.keys(SETUP_STEP_LABEL).length;
  const stepsDone = stepsTotal - missing.length;
  return { stepsDone, stepsTotal, done: missing.length === 0 };
}

// ---------------------------------------------------------------------------
// CSV template generation (pure — no DB, no auth needed to BUILD a template)
// ---------------------------------------------------------------------------

/** Escape a single CSV field per RFC 4180: quote when it contains a comma,
 *  quote, or newline; double inner quotes. All template values are safe
 *  in practice, but the rule is still correct. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Validate a template slug; returns the slug or throws (used by the
 *  authenticated download server fn — an unknown slug is rejected before
 *  anything is served). */
export function assertTemplateSlug(raw: unknown): TemplateSlug {
  const slug = String(raw ?? "").trim();
  if (!(slug in TEMPLATES)) {
    throw new Error("Unknown template.");
  }
  return slug as TemplateSlug;
}

/** Render one template as CSV text: # header comment, header row, one example
 *  row, then a plain-language field-definitions legend block (blank line
 *  separated). CSV text only — no macros, no formulas, no links, no PII. */
export function buildTemplateCsv(slug: TemplateSlug): string {
  const t = TEMPLATES[slug];
  const lines: string[] = [];
  lines.push(t.headerComment);
  lines.push(t.fields.map((f) => f.name).join(","));
  lines.push(t.exampleRow.map((v) => csvField(v)).join(","));
  lines.push("");
  lines.push("# FIELD DEFINITIONS — what each column accepts (run import later):");
  for (const f of t.fields) {
    lines.push(`# ${f.name} — ${f.legend}${f.required ? " (required)" : " (optional)"}`);
  }
  lines.push(`# EXAMPLE ROW (delete before importing): ${t.exampleRow.map((v) => csvField(v)).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

export const templateList = () =>
  (Object.keys(TEMPLATES) as TemplateSlug[]).map((slug) => TEMPLATES[slug]);

// ---------------------------------------------------------------------------
// Injectable cores — exact SQL shapes (tested against the local DB)
// ---------------------------------------------------------------------------

type ProfileRow = {
  id: number;
  operation_id: number;
  location: string | null;
  operation_type: OperationType | null;
  acres: number | null;
  primary_species: string | null;
  templates_downloaded: boolean;
  created_at: string;
  updated_at: string;
};

type OpRow = {
  id: number;
  name: string;
  onboarding_started_at: string | null;
  onboarding_completed_at: string | null;
};

/** Everything the onboarding UI + dashboard progress card needs for ONE
 *  operation. Pure(ish): takes the operation id and queries only rows scoped
 *  to it. */
export async function readOnboardingCore(db: OnboardingDb, operationId: number): Promise<OnboardingData> {
  const [opRows, profRows] = await Promise.all([
    db<OpRow[]>`
      SELECT id, name, onboarding_started_at::text AS onboarding_started_at,
             onboarding_completed_at::text AS onboarding_completed_at
      FROM operations WHERE id = ${operationId}`,
    db<ProfileRow[]>`
      SELECT id, operation_id, location, operation_type, acres::float8 AS acres,
             primary_species, templates_downloaded, created_at::text AS created_at,
             updated_at::text AS updated_at
      FROM operation_profile WHERE operation_id = ${operationId}`,
  ]);
  const op = opRows[0];
  if (!op) throw new Error("No operation found for this account.");
  const prof = profRows[0] ?? null;
  const missingSteps = prof
    ? setupStepKeys(prof)
    : (["operation_type", "acres", "primary_species", "templates"] as SetupStepKey[]);
  const progress = setupProgress(missingSteps);
  return {
    configured: true,
    operationId: op.id,
    operationName: op.name,
    profile: prof,
    onboardingStartedAt: op.onboarding_started_at,
    onboardingCompletedAt: op.onboarding_completed_at,
    setupDone: progress.done,
    missingSteps,
  };
}

/** Upsert the operation_profile row for ONE operation (insert with the
 *  explicit operation id, update only that op's row on conflict). Undefined
 *  keys are normalized to NULL (postgres.js rejects `undefined` values). */
export async function upsertProfileCore(
  db: OnboardingDb,
  operationId: number,
  p: OnboardingInput
): Promise<void> {
  const loc = p.location ?? null;
  const type = p.operation_type ?? null;
  const acres = p.acres ?? null;
  const species = p.primary_species ?? null;
  await db`
    INSERT INTO operation_profile (operation_id, location, operation_type, acres, primary_species)
    VALUES (${operationId}, ${loc}, ${type}, ${acres}, ${species})
    ON CONFLICT (operation_id) DO UPDATE SET
      location = EXCLUDED.location,
      operation_type = EXCLUDED.operation_type,
      acres = EXCLUDED.acres,
      primary_species = EXCLUDED.primary_species,
      updated_at = now()`;
}

/** Stamp onboarding_started_at on ONE operation (first save only). */
export async function stampStartedCore(db: OnboardingDb, operationId: number): Promise<void> {
  await db`
    UPDATE operations SET onboarding_started_at = COALESCE(onboarding_started_at, now())
    WHERE id = ${operationId}`;
}

/** Rename ONE operation row; returns 1 when the row existed (0 = not found /
 *  already deleted — a cross-ranch rename affects zero rows). */
export async function renameOperationCore(db: OnboardingDb, operationId: number, name: string): Promise<number> {
  const updated = await db`
    UPDATE operations SET name = ${name}
    WHERE id = ${operationId} RETURNING id`;
  return updated.length;
}

/** Mark setup complete on ONE operation. Idempotent. */
export async function finishOnboardingCore(db: OnboardingDb, operationId: number): Promise<void> {
  await db`
    UPDATE operations SET onboarding_completed_at = now()
    WHERE id = ${operationId}`;
}

/** Owner downloaded a template — edge the "templates downloaded" checklist
 *  step forward for ONE operation. Insert-if-new / update-if-exists. */
export async function markTemplatesCore(db: OnboardingDb, operationId: number): Promise<void> {
  await db`
    INSERT INTO operation_profile (operation_id, templates_downloaded)
    VALUES (${operationId}, true)
    ON CONFLICT (operation_id) DO UPDATE SET templates_downloaded = true, updated_at = now()`;
}

// ---------------------------------------------------------------------------
// Shared validation for onboarding fields (mirrors the other modules' style)
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** Positive decimal for acres; rejects negatives, zero, and junk. 99999 cap
 *  keeps the number sane for the app's check constraints. */
function positiveAcres(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Acres must be a positive number.");
  if (n > 99999) throw new Error("Acres look too large — check the number and try again.");
  return n;
}

export function parseOnboardingInput(raw: unknown): OnboardingInput {
  const d = (raw ?? {}) as Record<string, unknown>;
  const location = str(d.location);
  const primary = str(d.primary_species);
  if (primary && primary.length > 80) throw new Error("Primary species is too long (80 characters max).");
  if (location && location.length > 120) throw new Error("Location is too long (120 characters max).");
  // Unknown / unlisted types are REJECTED (not silently defaulted) so a stray
  // value never reaches the DB CHECK constraint or a customer's profile.
  const operationType = oneOf(d.operation_type, OPERATION_TYPES);
  if (d.operation_type !== undefined && d.operation_type !== null && d.operation_type !== "" && !operationType) {
    throw new Error("Pick an operation type from the list.");
  }
  return {
    location,
    operation_type: operationType,
    acres: positiveAcres(d.acres),
    primary_species: primary,
  };
}

// ---------------------------------------------------------------------------
// Server fns (auth + operation-scoped) — used by the routes
// ---------------------------------------------------------------------------

export const getOnboarding = createServerFn().handler(async (): Promise<OnboardingData> => {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      operationId: null,
      operationName: null,
      profile: null,
      onboardingStartedAt: null,
      onboardingCompletedAt: null,
      setupDone: false,
      missingSteps: [],
    };
  }
  try {
    const auth = await requireAuth();
    return await readOnboardingCore(sql(), auth.operationId);
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      operationId: null,
      operationName: null,
      profile: null,
      onboardingStartedAt: null,
      onboardingCompletedAt: null,
      setupDone: false,
      missingSteps: [],
    };
  }
});

/** Rename the operation row (owner-only), then return the fresh onboarding
 *  state so the UI can re-render its progress card. */
export const renameOperation = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const name = str(d.name);
    if (!name) throw new Error("Operation name is required.");
    if (name.length > 80) throw new Error("Operation name is too long (80 characters max).");
    return { name };
  })
  .handler(async ({ data }): Promise<{ ok: true; data: OnboardingData } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      if ((await renameOperationCore(db, auth.operationId, data.name)) === 0) {
        return { ok: false, error: "Operation no longer exists." };
      }
      return { ok: true, data: await readOnboardingCore(db, auth.operationId) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

/** Save/update the onboarding profile + stamp started-at, then return fresh
 *  state. Insert and update are scoped to the session operation. */
export const saveOnboarding = createServerFn({ method: "POST" })
  .validator(parseOnboardingInput)
  .handler(async ({ data: p }): Promise<{ ok: true; data: OnboardingData } | { ok: false; error: string }> => {
    if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
    try {
      const auth = await requireAuth();
      const db = sql();
      await upsertProfileCore(db, auth.operationId, p);
      await stampStartedCore(db, auth.operationId);
      return { ok: true, data: await readOnboardingCore(db, auth.operationId) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

/** Mark setup complete (owner finished the flow). Idempotent. */
export const finishOnboarding = createServerFn({ method: "POST" }).handler(async (): Promise<
  { ok: true; setupDone: boolean } | { ok: false; error: string }
> => {
  if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
  try {
    const auth = await requireAuth();
    await finishOnboardingCore(sql(), auth.operationId);
    return { ok: true, setupDone: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

/** Owner downloaded a template — edges the dashboard progress card forward.
 *  The "templates downloaded" checklist step counts on any download. */
export const markTemplatesDownloaded = createServerFn({ method: "POST" }).handler(async (): Promise<
  { ok: true; templatesDownloaded: boolean } | { ok: false; error: string }
> => {
  if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set — no database connected." };
  try {
    const auth = await requireAuth();
    await markTemplatesCore(sql(), auth.operationId);
    return { ok: true, templatesDownloaded: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

/** Authenticated template download endpoint (server fn = the app's router
 *  endpoint). Returns the CSV text; the client triggers a real Blob + anchor
 *  download. An unknown slug is rejected by assertTemplateSlug. */
export const getTemplateCsv = createServerFn({ method: "POST" })
  .validator(assertTemplateSlug)
  .handler(async ({ data: slug }): Promise<
    { ok: true; slug: TemplateSlug; filename: string; csv: string } | { ok: false; error: string }
  > => {
    try {
      await requireAuth();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Not authenticated." };
    }
    return { ok: true, slug, filename: `ranch-${slug}.csv`, csv: buildTemplateCsv(slug) };
  });

export type { OnboardingInput }; // re-export for routes/tests