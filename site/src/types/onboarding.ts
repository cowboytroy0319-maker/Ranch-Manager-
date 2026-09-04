// ============================================================================
// Ranch Manager Pro — Onboarding + downloadable CSV templates module types
// (shared client + server). All values are JSON-safe so they cross the
// server/client boundary without React refusing to render. The enum arrays
// below are the SINGLE source of truth for the values the app accepts — the
// CSV template generators and legend build directly on them, and tests assert
// template content matches them.
// ============================================================================

/** Primary operation types offered in onboarding. */
export const OPERATION_TYPES = [
  "cattle",
  "mixed_livestock",
  "horses",
  "crops_farm",
  "mixed_ranch_farm",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_TYPE_LABEL: Record<OperationType, string> = {
  cattle: "Cattle (beef or dairy)",
  mixed_livestock: "Mixed livestock",
  horses: "Horses",
  crops_farm: "Crops / farm",
  mixed_ranch_farm: "Mixed ranch & farm",
};

/** Optional primary species/focus values (free suggestions, stored as text). */
export const PRIMARY_SPECIES = ["cattle", "horses", "goats", "sheep"] as const;
export type PrimarySpecies = (typeof PRIMARY_SPECIES)[number];

export type OnboardingProfile = {
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

/** Onboarding payload as the client submits it (all fields optional). */
export type OnboardingInput = {
  location?: string | null;
  operation_type?: OperationType | null;
  acres?: number | null;
  primary_species?: string | null;
};

export type OnboardingData = {
  configured: boolean; // false when DATABASE_URL is missing (no-DB state)
  error?: string; // short human-readable reason when configured but broken
  operationId: number | null;
  operationName: string | null;
  profile: OnboardingProfile | null;
  onboardingStartedAt: string | null;
  onboardingCompletedAt: string | null;
  setupDone: boolean; // required checklist complete (see docs/ONBOARDING_TEMPLATES.md)
  missingSteps: SetupStepKey[];
};

/**
 * Setup checklist keys — the 5 required steps shown on the dashboard progress
 * card (see docs/ONBOARDING_TEMPLATES.md; templates downloaded increments when
 * an owner downloads any template). `stepsDone` is 1 (name) + completed steps.
 */
export const SETUP_STEPS = ["name", "operation_type", "acres", "primary_species", "templates"] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABEL: Record<SetupStepKey, string> = {
  name: "Name your operation",
  operation_type: "Choose operation type",
  acres: "Set your acres",
  primary_species: "Choose primary species / focus",
  templates: "Download starter templates",
};

// ---------------------------------------------------------------------------
// CSV download templates (Item 2 scope: templates ONLY — no import/export)
// ---------------------------------------------------------------------------

export type TemplateField = {
  name: string; // CSV column header (the app's accepted field name)
  required: boolean;
  example: string;
  legend: string; // plain-language definition of the accepted value(s)
};

export type CsvTemplate = {
  slug: string; // also the download filename: ranch-<slug>.csv
  title: string;
  emoji: string;
  description: string;
  headerComment: string; // the first line, prefixed with #
  fields: TemplateField[];
  exampleRow: string[]; // values matching fields, in field order
};

export const TEMPLATE_SLUGS = [
  "livestock",
  "pastures",
  "hay-feed",
  "equipment",
  "expenses",
  "tasks",
] as const;
export type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];

export const TEMPLATES: Record<TemplateSlug, CsvTemplate> = {
  livestock: {
    slug: "livestock",
    title: "Livestock",
    emoji: "🐄",
    description:
      "One row per animal. Tag/animal ID is your unique ear tag or ID — required. Species must be exactly cattle, horse, goat, or sheep. Leave optional fields blank and the defaults apply.",
    headerComment:
      "# Ranch Manager Pro — livestock.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: species=cattle|horse|goat|sheep; sex=female|male|castrated; status=active|pending|sold|deceased|culled|archived. Dates are YYYY-MM-DD. No formulas or macros in this file.",
    fields: [
      { name: "tag_number", required: true, example: "SV-101", legend: "Ear tag / animal ID — unique within this ranch (required)." },
      { name: "name", required: false, example: "Belle", legend: "Optional display name; blank defaults to the tag." },
      { name: "species", required: true, example: "cattle", legend: "cattle, horse, goat, or sheep (required, lowercase)." },
      { name: "sex", required: false, example: "female", legend: "female, male, or castrated (lowercase); blank = not set." },
      { name: "breed", required: false, example: "Angus", legend: "Free text breed or cross." },
      { name: "birth_date", required: false, example: "2022-03-14", legend: "YYYY-MM-DD; blank = unknown." },
      { name: "status", required: false, example: "active", legend: "active, pending, sold, deceased, culled, or archived (lowercase); blank = active." },
      { name: "pasture", required: false, example: "North Pasture", legend: "Free text current pasture/location." },
      { name: "notes", required: false, example: "Replacement heifer", legend: "Free text notes." },
    ],
    exampleRow: ["SV-101", "Belle", "cattle", "female", "Angus", "2022-03-14", "active", "North Pasture", "Replacement heifer"],
  },
  pastures: {
    slug: "pastures",
    title: "Pastures / acreage",
    emoji: "🌿",
    description:
      "One row per pasture or grazing unit. Size in acres is required and must be greater than zero. Status must be exactly grazing, resting, idle, or maintenance.",
    headerComment:
      "# Ranch Manager Pro — pastures.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: status=grazing|resting|idle|maintenance. size_acres must be a positive number. No formulas or macros in this file.",
    fields: [
      { name: "name", required: true, example: "North Pasture", legend: "Pasture name (required)." },
      { name: "size_acres", required: true, example: "120.5", legend: "Size in acres — positive decimal (required)." },
      { name: "location", required: false, example: "East section", legend: "Free text location." },
      { name: "status", required: false, example: "grazing", legend: "grazing, resting, idle, or maintenance (lowercase); blank = resting." },
      { name: "soil_type", required: false, example: "sandy loam", legend: "Free text soil type." },
      { name: "notes", required: false, example: "Rotational cell 3", legend: "Free text notes." },
    ],
    exampleRow: ["North Pasture", "120.5", "East section", "grazing", "sandy loam", "Rotational cell 3"],
  },
  "hay-feed": {
    slug: "hay-feed",
    title: "Hay / feed inventory",
    emoji: "🌾",
    description:
      "One row per hay stack or feed bin. Hay types are grass, alfalfa, mixed, or other; hay units are bales or tons. For bagged/processed feed use the feed-style columns with unit lbs, bags, or tons.",
    headerComment:
      "# Ranch Manager Pro — hay-feed.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: type=grass|alfalfa|mixed|other; unit=bales|tons (hay) or lbs|bags|tons (feed); category=grain|supplement|mineral|hay-substitute|other. Quantities and bale_weight must be non-negative numbers. No formulas or macros in this file.",
    fields: [
      { name: "type", required: true, example: "grass", legend: "Hay/feed type: grass, alfalfa, mixed, or other (required)." },
      { name: "quantity", required: true, example: "240", legend: "Quantity on hand — non-negative number (required)." },
      { name: "unit", required: true, example: "bales", legend: "bales or tons for hay; lbs, bags, or tons for feed (required)." },
      { name: "bale_weight", required: false, example: "60", legend: "Pounds per bale (bales only, optional)." },
      { name: "source", required: false, example: "Johnson Hay Co.", legend: "Free text field/source or supplier." },
      { name: "storage", required: false, example: "North barn", legend: "Free text storage location." },
      { name: "acquired", required: false, example: "2026-06-01", legend: "Acquisition date YYYY-MM-DD (optional)." },
      { name: "low_stock", required: false, example: "40", legend: "Low-stock alert threshold — non-negative number (optional; blank = 0)." },
      { name: "notes", required: false, example: "First cutting", legend: "Free text notes." },
    ],
    exampleRow: ["grass", "240", "bales", "60", "Johnson Hay Co.", "North barn", "2026-06-01", "40", "First cutting"],
  },
  equipment: {
    slug: "equipment",
    title: "Equipment",
    emoji: "🚜",
    description:
      "One row per machine/asset. Category must be exactly truck, tractor, trailer, implement, atv, stationary, or other. Hours/miles are the two meter types — enter the one your machine tracks.",
    headerComment:
      "# Ranch Manager Pro — equipment.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: category=truck|tractor|trailer|implement|atv|stationary|other; status=in-service|maintenance-due|out-of-service; condition=excellent|good|fair|poor; fuel_type=diesel|gasoline|gas|electric|other. Year 1900-2100; hours/miles non-negative. No formulas or macros in this file.",
    fields: [
      { name: "name", required: true, example: "2020 Ford F-350", legend: "Asset name (required)." },
      { name: "category", required: true, example: "truck", legend: "truck, tractor, trailer, implement, atv, stationary, or other (required)." },
      { name: "make", required: false, example: "Ford", legend: "Free text make." },
      { name: "model", required: false, example: "F-350", legend: "Free text model." },
      { name: "year", required: false, example: "2020", legend: "Year (1900-2100); blank = unknown." },
      { name: "hours", required: false, example: "18400", legend: "Engine hours meter — non-negative number (optional)." },
      { name: "miles", required: false, example: "", legend: "Odometer miles meter — non-negative number (optional)." },
      { name: "location", required: false, example: "Shop yard", legend: "Free text location." },
      { name: "fuel_type", required: false, example: "diesel", legend: "diesel, gasoline, gas, electric, or other (blank = other)." },
      { name: "notes", required: false, example: "Pulls stock trailer", legend: "Free text notes." },
    ],
    exampleRow: ["2020 Ford F-350", "truck", "Ford", "F-350", "2020", "18400", "", "Shop yard", "diesel", "Pulls stock trailer"],
  },
  expenses: {
    slug: "expenses",
    title: "Expenses",
    emoji: "🧾",
    description:
      "One row per expense. Category must be exactly feed, vet_health, maintenance, insurance, fuel, or other. Amount is in whole dollars (stored as cents internally). Dates are YYYY-MM-DD.",
    headerComment:
      "# Ranch Manager Pro — expenses.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: category=feed|vet_health|maintenance|insurance|fuel|other. amount in dollars (non-negative); date YYYY-MM-DD. No formulas or macros in this file.",
    fields: [
      { name: "category", required: true, example: "vet_health", legend: "feed, vet_health, maintenance, insurance, fuel, or other (required)." },
      { name: "amount", required: true, example: "185.00", legend: "Amount in whole dollars — non-negative (required)." },
      { name: "date", required: true, example: "2026-07-12", legend: "Expense date YYYY-MM-DD (required)." },
      { name: "vendor", required: false, example: "High Plains Vet", legend: "Free text vendor." },
      { name: "job", required: false, example: "Fall processing", legend: "Free text job/activity (for cost allocation)." },
      { name: "notes", required: false, example: "Cow herd vaccinations", legend: "Free text notes." },
    ],
    exampleRow: ["vet_health", "185.00", "2026-07-12", "High Plains Vet", "Fall processing", "Cow herd vaccinations"],
  },
  tasks: {
    slug: "tasks",
    title: "Ranch tasks",
    emoji: "✅",
    description:
      "One row per task. Status must be exactly to_do, in_progress, completed, or canceled; priority low, normal, high, or urgent; category livestock, feed/hay, pasture, fencing/water, equipment, crops/farm, paperwork, or general.",
    headerComment:
      "# Ranch Manager Pro — tasks.csv — header row + one example row (below). Delete the example row before importing to a spreadsheet. Accepted values: status=to_do|in_progress|completed|canceled; priority=low|normal|high|urgent; category=livestock|feed/hay|pasture|fencing/water|equipment|crops/farm|paperwork|general. Due date YYYY-MM-DD (blank = none). No formulas or macros in this file.",
    fields: [
      { name: "title", required: true, example: "Check water in north pasture", legend: "Task title (required)." },
      { name: "status", required: false, example: "to_do", legend: "to_do, in_progress, completed, or canceled (blank = to_do)." },
      { name: "priority", required: false, example: "high", legend: "low, normal, high, or urgent (blank = normal)." },
      { name: "due_date", required: false, example: "2026-08-20", legend: "YYYY-MM-DD (blank = no due date)." },
      { name: "category", required: false, example: "pasture", legend: "livestock, feed/hay, pasture, fencing/water, equipment, crops/farm, paperwork, or general (blank = general)." },
      { name: "notes", required: false, example: "Fill both troughs", legend: "Free text description/notes." },
    ],
    exampleRow: ["Check water in north pasture", "to_do", "high", "2026-08-20", "pasture", "Fill both troughs"],
  },
};