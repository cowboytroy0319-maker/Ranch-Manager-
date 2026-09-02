/**
 * Seed script — a small realistic mixed operation for the Livestock, Hay & Feed,
 * Pasture, and Equipment modules.
 *
 *   bun run db:seed          # runs migrations first, then (re)seeds demo data
 *
 * Idempotent AND non-destructive: master rows (herd groups, animals, hay, feed,
 * pastures, equipment) are matched by natural key and their existing ids are
 * reused, so re-running never duplicates them and never wipes user-added rows.
 * The generated detail/log tables (health events, usage log, grazing history,
 * assignments, observations, maintenance, fuel) are cleared only for the seed's
 * own parents and re-inserted, so their counts stay flat across runs. Health-
 * event dates and usage-log dates are computed relative to "today", so upcoming
 * due dates / recent usage always land in the right window regardless of when
 * you seed.
 */
import { closeDb, sql } from "../src/db";
import { runMigrations } from "./migrate";

const day = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number): string => new Date(Date.now() + n * day).toISOString().slice(0, 10);
/** Return a YYYY-MM-DD date inside the CURRENT month, clamped to not exceed
 * today. Used for seeded expense rows so they always land in the month the
 * daily dashboard reports, regardless of when the seed is run. */
const monthDay = (dayOfMonth: number): string => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const d = Math.min(dayOfMonth, last, now.getDate());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Look up an existing row's id by a natural key (e.g. pastures.name,
 * animals.tag_number, feed_inventory.name). Returns null when absent so the
 * caller can decide to insert a fresh row. This is the core of the seed's
 * idempotency: masters are matched + reused (never re-inserted as duplicates),
 * so the child/log tables below always reference real, existing parent ids.
 */
async function findId(
  db: ReturnType<typeof sql>,
  table: string,
  column: string,
  value: string
): Promise<number | null> {
  const rows = await db<[{ id: number }]>`
    SELECT id FROM ${db(table)}
    WHERE ${db(column)} = ${value}
    LIMIT 1`;
  return rows.length ? rows[0].id : null;
}

type AnimalSeed = {
  species: "cattle" | "horse" | "goat" | "sheep";
  name: string;
  tag_number?: string;
  sex?: "female" | "male" | "castrated";
  breed?: string;
  birth_date?: string;
  status?: "active" | "sold" | "deceased" | "pending";
  group?: number; // index into GROUPS
  pasture?: string;
  notes?: string;
};

const GROUPS = [
  { name: "North Cowherd", species: "cattle", notes: "Spring-calving commercial cows and heifers." },
  { name: "Browse Crew", species: "goat", notes: "Brush-control mob, rotates behind the cattle." },
  { name: "Ewe Flock", species: "sheep", notes: "Hair-sheep flock, lambing in March." },
] as const;

const NORTH = "North River Pasture";
const SOUTH = "South Ridge Pasture";

const ANIMALS: AnimalSeed[] = [
  // --- 12 cattle ---
  { species: "cattle", name: "Belle", tag_number: "SV-101", sex: "female", breed: "Angus", birth_date: "2019-03-14", group: 0, pasture: NORTH, notes: "Lead cow, easy keeper." },
  { species: "cattle", name: "Blue 4", tag_number: "SV-102", sex: "female", breed: "Angus", birth_date: "2020-04-02", group: 0, pasture: NORTH },
  { species: "cattle", name: "Duchess", tag_number: "SV-103", sex: "female", breed: "Hereford", birth_date: "2018-09-21", group: 0, pasture: NORTH, notes: "Grand-dam line, keep replacements." },
  { species: "cattle", name: "SV-104", tag_number: "SV-104", sex: "female", breed: "Angus cross", birth_date: "2021-02-11", group: 0, pasture: NORTH },
  { species: "cattle", name: "Cinnamon", tag_number: "SV-105", sex: "female", breed: "Red Angus", birth_date: "2020-05-30", group: 0, pasture: NORTH },
  { species: "cattle", name: "Big John", tag_number: "SV-106", sex: "male", breed: "Hereford", birth_date: "2017-03-03", group: 0, pasture: NORTH, notes: "Herd bull — lease shared with neighbor." },
  { species: "cattle", name: "SV-107", tag_number: "SV-107", sex: "female", breed: "Angus", birth_date: "2022-04-18", group: 0, pasture: SOUTH },
  { species: "cattle", name: "Rosie", tag_number: "SV-108", sex: "female", breed: "Hereford", birth_date: "2021-08-25", group: 0, pasture: SOUTH },
  { species: "cattle", name: "SV-109", tag_number: "SV-109", sex: "castrated", breed: "Angus cross", birth_date: "2023-03-09", group: 0, pasture: SOUTH, notes: "Steer, grass-finish candidate." },
  { species: "cattle", name: "SV-110", tag_number: "SV-110", sex: "castrated", breed: "Angus cross", birth_date: "2023-03-15", group: 0, pasture: SOUTH, notes: "Steer, grass-finish candidate." },
  { species: "cattle", name: "Freightliner", tag_number: "SV-111", sex: "female", breed: "Angus", birth_date: "2024-09-01", status: "pending", group: 0, pasture: SOUTH, notes: "Bred heifer arriving from Hammon sale — pending delivery." },
  { species: "cattle", name: "Old Bess", tag_number: "SV-099", sex: "female", breed: "Hereford", birth_date: "2013-04-10", status: "sold", group: 0, notes: "Sold to T. Reyes at December dispersal." },
  // --- 4 horses ---
  { species: "horse", name: "Duke", tag_number: "H-01", sex: "castrated", breed: "Quarter Horse", birth_date: "2016-05-12", pasture: NORTH, notes: "Primary gathering horse." },
  { species: "horse", name: "Smokey", tag_number: "H-02", sex: "castrated", breed: "Quarter Horse", birth_date: "2014-06-20", pasture: NORTH },
  { species: "horse", name: "Molly", tag_number: "H-03", sex: "female", breed: "Paint", birth_date: "2018-04-30", pasture: SOUTH, notes: "Kids' trail horse." },
  { species: "horse", name: "Chico", tag_number: "H-04", sex: "male", breed: "Mustang", birth_date: "2019-07-08", pasture: SOUTH, notes: "Green colt, in training." },
  // --- 8 goats ---
  { species: "goat", name: "Nubian 201", tag_number: "G-201", sex: "female", breed: "Nubian", birth_date: "2022-02-14", group: 1, pasture: SOUTH },
  { species: "goat", name: "Nubian 202", tag_number: "G-202", sex: "female", breed: "Nubian", birth_date: "2022-02-14", group: 1, pasture: SOUTH },
  { species: "goat", name: "Kiko 203", tag_number: "G-203", sex: "female", breed: "Kiko", birth_date: "2023-03-22", group: 1, pasture: SOUTH },
  { species: "goat", name: "Kiko 204", tag_number: "G-204", sex: "female", breed: "Kiko", birth_date: "2023-03-22", group: 1, pasture: SOUTH },
  { species: "goat", name: "Boer 205", tag_number: "G-205", sex: "castrated", breed: "Boer", birth_date: "2023-11-05", group: 1, pasture: SOUTH, notes: "Wether, lead brush eater." },
  { species: "goat", name: "Boer 206", tag_number: "G-206", sex: "castrated", breed: "Boer", birth_date: "2023-11-05", group: 1, pasture: SOUTH },
  { species: "goat", name: "Kiko 207", tag_number: "G-207", sex: "female", breed: "Kiko", birth_date: "2024-04-01", group: 1, pasture: SOUTH },
  { species: "goat", name: "Buck 208", tag_number: "G-208", sex: "male", breed: "Boer", birth_date: "2021-01-19", group: 1, pasture: SOUTH, notes: "Herd sire." },
  // --- 6 sheep ---
  { species: "sheep", name: "Ram 901", tag_number: "S-901", sex: "male", breed: "Dorper", birth_date: "2021-03-08", group: 2, pasture: NORTH },
  { species: "sheep", name: "Ewe 902", tag_number: "S-902", sex: "female", breed: "Dorper", birth_date: "2022-03-30", group: 2, pasture: NORTH },
  { species: "sheep", name: "Ewe 903", tag_number: "S-903", sex: "female", breed: "Katahdin", birth_date: "2022-04-12", group: 2, pasture: NORTH },
  { species: "sheep", name: "Ewe 904", tag_number: "S-904", sex: "female", breed: "Katahdin", birth_date: "2023-03-17", group: 2, pasture: NORTH },
  { species: "sheep", name: "Ewe 905", tag_number: "S-905", sex: "female", breed: "Dorper", birth_date: "2023-03-17", group: 2, pasture: NORTH },
  { species: "sheep", name: "Ewe 906", tag_number: "S-906", sex: "female", breed: "Dorper cross", birth_date: "2024-02-25", group: 2, pasture: NORTH, notes: "Twin, good mother line." },
];

type EventSeed = {
  tag: string;
  event_date: number; // days from now (negative = past)
  type: "vaccination" | "treatment" | "inspection" | "injury" | "other";
  description: string;
  product?: string;
  dosage?: string;
  vet?: string;
  withdrawal_days?: number;
  next_due?: number; // days from now
};

const EVENTS: EventSeed[] = [
  { tag: "SV-101", event_date: -45, type: "vaccination", description: "8-way Clostridium (blackleg) booster", product: "Covexin 8", dosage: "2 ml SQ", withdrawal_days: 21, next_due: 28 },
  { tag: "SV-102", event_date: -45, type: "vaccination", description: "8-way Clostridium (blackleg) booster", product: "Covexin 8", dosage: "2 ml SQ", withdrawal_days: 21, next_due: 28 },
  { tag: "SV-104", event_date: -40, type: "treatment", description: "Pinkeye (IBK) — both eyes", product: "LA-200 (oxytetracycline)", dosage: "10 ml IM, repeat 72h", vet: "Dr. Whitfield", withdrawal_days: 28, next_due: 6 },
  { tag: "SV-107", event_date: -30, type: "vaccination", description: "Respiratory complex pre-weaning", product: "Bovi-Shield GOLD 5", dosage: "2 ml SQ", next_due: 180 },
  { tag: "SV-106", event_date: -60, type: "inspection", description: "Breeding soundness exam", vet: "Dr. Whitfield", next_due: 300 },
  { tag: "H-01", event_date: -75, type: "inspection", description: "Annual Coggins test (EIA)", vet: "Cedar Valley Equine", next_due: 90 },
  { tag: "H-02", event_date: -75, type: "inspection", description: "Annual Coggins test (EIA)", vet: "Cedar Valley Equine", next_due: 90 },
  { tag: "H-01", event_date: -20, type: "vaccination", description: "West Nile virus + EEE/WEE", product: "West Nile-INNOVATOR", dosage: "1 ml IM", next_due: 14 },
  { tag: "H-03", event_date: -35, type: "treatment", description: "Hoof trim + abscess drain, left front", product: "Iceman poultice", vet: "K. Ruiz (farrier)", next_due: 55 },
  { tag: "H-04", event_date: -10, type: "injury", description: "Wire cut, right hind pastern", product: "Penicillin G", dosage: "10 ml IM q24h x5d", vet: "Dr. Whitfield", withdrawal_days: 30, next_due: 2 },
  { tag: "G-201", event_date: -55, type: "treatment", description: "Deworming — FAMACHA score 3", product: "Cydectin (moxidectin)", dosage: "1 ml/10 lb SQ", withdrawal_days: 35, next_due: 10 },
  { tag: "G-203", event_date: -55, type: "treatment", description: "Deworming — FAMACHA score 3", product: "Cydectin (moxidectin)", dosage: "1 ml/10 lb SQ", withdrawal_days: 35, next_due: 10 },
  { tag: "G-208", event_date: -100, type: "other", description: "Annual hoof trim", vet: "K. Ruiz (farrier)", next_due: 265 },
  { tag: "S-902", event_date: -50, type: "vaccination", description: "CDT (clostridium C&D + tetanus)", product: "Bar-Vac CD/T", dosage: "2 ml SQ", next_due: 7 },
  { tag: "S-903", event_date: -50, type: "vaccination", description: "CDT (clostridium C&D + tetanus)", product: "Bar-Vac CD/T", dosage: "2 ml SQ", next_due: 7 },
  { tag: "S-901", event_date: -50, type: "other", description: "Pre-breeding condition check", vet: "Dr. Whitfield", next_due: 21 },
];

// ---------------------------------------------------------------------------
// Hay yard — current on-hand levels (what's in the barns right now)
// ---------------------------------------------------------------------------

type HaySeed = {
  feed_type: "grass" | "alfalfa" | "mixed" | "other";
  cutting: string;
  field_or_source: string;
  storage_location: string;
  quantity: number;
  unit: "bales" | "tons";
  bale_weight_lbs?: number;
  acquired: number; // days from now (negative = past)
  low_stock_threshold: number;
  notes?: string;
};

const HAY: HaySeed[] = [
  { feed_type: "grass", cutting: "2nd", field_or_source: "River Field", storage_location: "Main barn — south row", quantity: 640, unit: "bales", bale_weight_lbs: 62, acquired: -120, low_stock_threshold: 150, notes: "Coastal bermudagrass, net-wrapped, no rain damage." },
  { feed_type: "alfalfa", cutting: "3rd", field_or_source: "Bought — Mule Shoe Dairy", storage_location: "Hay barn — east stack", quantity: 180, unit: "bales", bale_weight_lbs: 68, acquired: -75, low_stock_threshold: 60, notes: "For the ewe flock and weaning calves." },
  { feed_type: "mixed", cutting: "2nd", field_or_source: "North Pivot", storage_location: "Loafing shed stack", quantity: 4.5, unit: "tons", acquired: -40, low_stock_threshold: 6, notes: "Big round bales, ~850 lb avg — the cold-weather reserve." },
  { feed_type: "other", cutting: "1st", field_or_source: "West Field", storage_location: "Barn loft", quantity: 96, unit: "bales", bale_weight_lbs: 52, acquired: -150, low_stock_threshold: 40, notes: "Oat hay, saved for the goat crew in winter." },
  { feed_type: "grass", cutting: "3rd", field_or_source: "Neighbor's meadow (custom baled)", storage_location: "Tool shed lean-to", quantity: 28, unit: "bales", bale_weight_lbs: 55, acquired: -20, low_stock_threshold: 40, notes: "Small squares for the horses — reorder before fall." },
];

type FeedSeed = {
  name: string;
  category: "grain" | "supplement" | "mineral" | "hay-substitute" | "other";
  quantity: number;
  unit: "lbs" | "bags" | "tons";
  supplier?: string;
  unit_cost_cents?: number; // cents per the listed unit
  low_stock_threshold: number;
  notes?: string;
};

const FEED: FeedSeed[] = [
  { name: "20% range cubes", category: "grain", quantity: 1400, unit: "lbs", supplier: "Chappell Feed & Seed", unit_cost_cents: 19, low_stock_threshold: 400, notes: "Supplement on dry grass — feed truck picks up." },
  { name: "Cattle mineral w/ fly control", category: "mineral", quantity: 175, unit: "lbs", supplier: "Purina dealer — Stephenville", unit_cost_cents: 62, low_stock_threshold: 200, notes: "Free-choice feeders, one per water trough." },
  { name: "Whole oats", category: "grain", quantity: 850, unit: "lbs", supplier: "Chappell Feed & Seed", unit_cost_cents: 24, low_stock_threshold: 300 },
  { name: "12% sweet feed", category: "grain", quantity: 18, unit: "bags", supplier: "Atwood Farm Store", unit_cost_cents: 1850, low_stock_threshold: 6, notes: "50 lb bags — flushing the ewes pre-breeding." },
  { name: "Sheep & goat mineral", category: "mineral", quantity: 260, unit: "lbs", supplier: "Atwood Farm Store", unit_cost_cents: 55, low_stock_threshold: 100, notes: "Copper-safe formula for the small ruminants." },
];

// Deterministic pseudo-random (no Math.random — seeds must be reproducible).
const rnd = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** 18 days of plausible feeding across the herd groups (dates relative to now). */
async function seedUsage(
  db: ReturnType<typeof sql>,
  hayId: number[],
  feedId: number[],
  groupIds: number[]
): Promise<number> {
  const [GRASS, ALFALFA, MIXED, OAT, TEFF] = hayId;
  const [CUBES, CATTLEMIN, , SWEET, SRMIN] = feedId; // whole oats aren't logged in the demo window
  const CATTLE = groupIds[0];
  const GOATS = groupIds[1];
  const EWES = groupIds[2];
  let n = 0;

  const log = async (
    daysAgo: number,
    kind: "hay" | "feed",
    itemId: number,
    quantity: number,
    unit: string,
    groupId: number | null,
    pasture: string | null,
    notes?: string
  ) => {
    await db`
      INSERT INTO usage_log (log_date, item_kind, hay_item_id, feed_item_id, quantity, unit, herd_group_id, pasture, notes)
      VALUES (${daysFromNow(-daysAgo)}, ${kind},
              ${kind === "hay" ? itemId : null}, ${kind === "feed" ? itemId : null},
              ${quantity}, ${unit}, ${groupId}, ${pasture}, ${notes ?? null})`;
    n += 1;
  };

  for (let d = 17; d >= 0; d--) {
    // Grass bales to the cowherd on most days (skip days grass carries them).
    if (rnd(d * 3 + 1) > 0.25) {
      await log(d, "hay", GRASS, 2 + Math.floor(rnd(d * 3 + 2) * 3), "bales", CATTLE, NORTH, "Fed at the north feeder, ring moved after.");
    }
    // Round bales off the mixed stack to the south bunch, roughly every 3rd day.
    if (d % 3 === 0) {
      await log(d, "hay", MIXED, 0.5 + (d % 2) * 0.25, "tons", CATTLE, SOUTH, "Rolled out a round bale behind the water tank.");
    }
    // Alfalfa every other day to the ewe flock.
    if (d % 2 === 0) {
      await log(d, "hay", ALFALFA, 1 + Math.floor(rnd(d + 7) * 2), "bales", EWES, NORTH);
    }
    // Oat hay to the goat crew ~weekly.
    if (d % 4 === 0) {
      await log(d, "hay", OAT, 1, "bales", GOATS, SOUTH, "Bunk feed while the browse is short.");
    }
    // Small squares for the horses (no herd group — horses run loose).
    if (d % 2 === 1) {
      await log(d, "hay", TEFF, 2, "bales", null, NORTH, "Horse feeder by the tack room.");
    }
    // Minerals & cubes.
    if (d % 2 === 0) await log(d, "feed", CATTLEMIN, 12 + Math.floor(rnd(d + 3) * 5), "lbs", CATTLE, null, "Topped both mineral feeders.");
    if (d % 4 === 1) await log(d, "feed", SRMIN, 14 + Math.floor(rnd(d + 5) * 4), "lbs", GOATS, null);
    if (d % 3 === 2) await log(d, "feed", CUBES, 60 + Math.floor(rnd(d + 9) * 20), "lbs", CATTLE, SOUTH, "Range cubes off the flatbed.");
    if (d % 5 === 4) await log(d, "feed", SWEET, 1, "bags", EWES, null, "Flush ration — 1 bag split across two troughs.");
  }
  return n;
}

// ---------------------------------------------------------------------------
// Pasture & grazing (0003) — paddocks, assignments, grazing/rest history, notes
// ---------------------------------------------------------------------------

type PastureSeed = {
  name: string;
  size_acres: number;
  location: string;
  status: "grazing" | "resting" | "idle" | "maintenance";
  soil_type?: string;
  notes?: string;
  graze: number; // days grazed per rotation cycle
  rest: number; // days rested per rotation cycle
  offset: number; // phase offset into the cycle
};

const PASTURES: PastureSeed[] = [
  { name: "North River Pasture", size_acres: 210, location: "Along the river north of the barn", status: "grazing", soil_type: "Sandy loam, river-bottom", notes: "Best regrowth of the year — reserve for weaning calves.", graze: 14, rest: 21, offset: 0 },
  { name: "South Ridge Pasture", size_acres: 175, location: "South-facing ridges", status: "grazing", soil_type: "Gravelly upland", notes: "Keeps the goat mob on the brush; fence off the cedar edge.", graze: 10, rest: 30, offset: 5 },
  { name: "Lambing Ground", size_acres: 22, location: "Near the house, fenced tight", status: "grazing", soil_type: "Clay loam", notes: "Close to the barn for lambing — predator-safe.", graze: 7, rest: 35, offset: 12 },
  { name: "East Hay Meadow", size_acres: 120, location: "East bottom by the creek", status: "resting", soil_type: "Deep silt loam", notes: "Put up 2 cuttings this year — resting before a fall graze-down.", graze: 8, rest: 45, offset: 20 },
  { name: "West Brush Trap", size_acres: 45, location: "West scrub below the ridge", status: "resting", soil_type: "Shallow rocky", notes: "Goats cleared the cedar — let it regrow before re-grazing.", graze: 5, rest: 60, offset: 3 },
  { name: "Calf Nursery", size_acres: 30, location: "Behind the barn paddocks", status: "maintenance", soil_type: "Sandy loam", notes: "Fence replaced on the north line — reseed the gate approach.", graze: 7, rest: 40, offset: 9 },
  { name: "Bull Lot", size_acres: 8, location: "Adjoining the corrals", status: "resting", soil_type: "Hardpan, heavy use", notes: "Holding pen for the herd bull — sacrifice lot, feed hay here.", graze: 4, rest: 90, offset: 25 },
  { name: "Back Forty", size_acres: 260, location: "Far northwest quarter", status: "idle", soil_type: "Native prairie mix", notes: "Stockpiled for winter grazing — do not open until freeze-up.", graze: 21, rest: 28, offset: 17 },
];

type AssignmentSeed = {
  pasture: string; // matches a PASTURES name
  group: number | null; // index into GROUPS
  assigned: number; // days from now (negative = past)
  target_days: number; // target grazing days
  ended?: number; // days from now when it ended (omit = still active)
  notes?: string;
};

const ASSIGNMENTS: AssignmentSeed[] = [
  { pasture: "North River Pasture", group: 0, assigned: -21, target_days: 21, notes: "Spring cow/calf pairs on the best regrowth." },
  { pasture: "South Ridge Pasture", group: 1, assigned: -10, target_days: 14, notes: "Goat mob on brush after the cedar pass in the trap." },
  { pasture: "Lambing Ground", group: 2, assigned: -14, target_days: 21, notes: "Ewes and lambs, sheltered and close to the barn." },
  { pasture: "West Brush Trap", group: 1, assigned: -31, target_days: 10, ended: -10, notes: "Cedar and sumac knock-down, then moved to South Ridge." },
  { pasture: "East Hay Meadow", group: 0, assigned: -52, target_days: 14, ended: -21, notes: "Graze-down of the 2nd cutting stubble in late summer." },
  { pasture: "Bull Lot", group: null, assigned: -5, target_days: 30, notes: "Herd bull in the sacrifice lot on hay through breeding." },
];

type ObservationSeed = {
  pasture: string; // matches a PASTURES name
  observed: number; // days from now (negative = past)
  category: "forage" | "water" | "fence" | "soil" | "pest" | "other";
  note: string;
  action_due?: number; // days from now
};

const OBSERVATIONS: ObservationSeed[] = [
  { pasture: "North River Pasture", observed: -2, category: "forage", note: "Clover thick near the river bend — cows grazing it down evenly.", action_due: 7 },
  { pasture: "North River Pasture", observed: -3, category: "water", note: "Trough 2 float is sticking, fills slow — will run dry on a hot day.", action_due: 1 },
  { pasture: "South Ridge Pasture", observed: -6, category: "pest", note: "Cedar regrowth on the south face — plan another goat pass after rest.", action_due: 14 },
  { pasture: "East Hay Meadow", observed: -12, category: "soil", note: "Soil test back from the lab — low phosphorus, plan spring fertilization.", action_due: 60 },
  { pasture: "Calf Nursery", observed: -4, category: "fence", note: "North line sagging between posts 12–18 — tighten before calves go in.", action_due: 3 },
  { pasture: "Lambing Ground", observed: -9, category: "other", note: "Southwest corner drains poorly — reshaped last year, reseed this spring.", action_due: 30 },
];

// ---------------------------------------------------------------------------
// Equipment, fuel, & maintenance (0004) — fleet register, service history +
// open repairs, and a fuel log across the trucks/tractors.
// ---------------------------------------------------------------------------

type EquipmentSeed = {
  name: string;
  category: "truck" | "tractor" | "trailer" | "implement" | "atv" | "stationary" | "other";
  make?: string;
  model?: string;
  year?: number;
  hours?: number;
  miles?: number;
  condition?: "excellent" | "good" | "fair" | "poor";
  status: "in-service" | "maintenance-due" | "out-of-service";
  location?: string;
  license_plate?: string;
  fuel_type?: "diesel" | "gasoline" | "gas" | "electric" | "other";
  notes?: string;
};

const EQUIPMENT: EquipmentSeed[] = [
  { name: "Ford F-350 Service Truck", category: "truck", make: "Ford", model: "F-350 4x4", year: 2019, miles: 112400, condition: "good", status: "in-service", location: "Main shop", license_plate: "SV 3501", fuel_type: "diesel", notes: "Baler feed runs and parts hauls." },
  { name: "Chevy Silverado 2500", category: "truck", make: "Chevrolet", model: "Silverado 2500HD", year: 2016, miles: 84500, condition: "good", status: "maintenance-due", location: "Main shop", license_plate: "SV 2500", fuel_type: "diesel", notes: "Primary gathering rig — oil change due at 84,500 mi." },
  { name: "John Deere 6120M", category: "tractor", make: "John Deere", model: "6120M", year: 2020, hours: 2480, condition: "good", status: "in-service", location: "Equipment barn", fuel_type: "diesel", notes: "Daily chore tractor." },
  { name: "Kubota M7060", category: "tractor", make: "Kubota", model: "M7060", year: 2017, hours: 1320, condition: "good", status: "in-service", location: "Equipment barn", fuel_type: "diesel" },
  { name: "John Deere 8320R", category: "tractor", make: "John Deere", model: "8320R", year: 2015, hours: 6100, condition: "fair", status: "maintenance-due", location: "North shed", fuel_type: "diesel", notes: "Hydraulic + engine-oil service due at 6,200 hrs." },
  { name: "24' Gooseneck Stock Trailer", category: "trailer", make: "Featherlite", model: "24' GN", year: 2018, condition: "good", status: "in-service", location: "Stockyard lot", license_plate: "SV 9122", notes: "Springs greased fall and spring." },
  { name: "20' Flatbed Utility Trailer", category: "trailer", make: "Big Tex", model: "20' Flatbed", year: 2014, condition: "fair", status: "out-of-service", location: "Behind shop", license_plate: "SV 4871", notes: "Deck boards rotting — open repair, parts on order." },
  { name: "John Deere 568 Baler", category: "implement", make: "John Deere", model: "568", year: 2019, hours: 890, condition: "good", status: "maintenance-due", location: "Hay barn", notes: "Knotter/twine-arm service due by date before next cutting." },
  { name: "Hay Squeeze Loader", category: "implement", make: "Jiffy", model: "1580", year: 2016, hours: 1210, condition: "good", status: "in-service", location: "Hay barn" },
  { name: "Feed Wagon", category: "implement", make: "Roto-Mix", model: "314-12", year: 2013, hours: 2760, condition: "fair", status: "in-service", location: "Feed bay", notes: "Auger chain replacement over the winter." },
  { name: "Polaris Ranger 1000", category: "atv", make: "Polaris", model: "Ranger 1000", year: 2022, miles: 3240, condition: "excellent", status: "in-service", location: "Main shop", fuel_type: "gasoline", notes: "Fence and water checks." },
  { name: "500-gal Diesel Bulk Tank", category: "stationary", make: "—", model: "Skid tank", year: 2020, condition: "good", status: "in-service", location: "Fuel rack", fuel_type: "diesel", notes: "On-farm diesel — pump backs up the tractor fleet." },
];

type MaintSeed = {
  unit: string; // matches an EQUIPMENT name
  service_date: number; // days from now (negative = past)
  service_type: "oil-change" | "scheduled" | "repair" | "tire" | "inspection" | "other";
  description: string;
  cost_cents?: number;
  meter_hours?: number;
  meter_miles?: number;
  status?: "done" | "open";
  next_due_date?: number; // days from now
  next_due_hours?: number;
  next_due_miles?: number;
  vendor?: string;
};

const MAINT: MaintSeed[] = [
  // Chevy Silverado — oil due now at current 84,500 mi, plus an open brake inspection.
  { unit: "Chevy Silverado 2500", service_date: -170, service_type: "oil-change", description: "Engine oil + filter; fuel filter", cost_cents: 8900, meter_miles: 79000, next_due_miles: 84500, vendor: "Main shop" },
  { unit: "Chevy Silverado 2500", service_date: -3, service_type: "inspection", description: "Front brake pads worn — caliper sticking", status: "open", vendor: "Driveline Auto" },
  // Ford F-350 — recent oil change, next due in ~600 mi.
  { unit: "Ford F-350 Service Truck", service_date: -30, service_type: "oil-change", description: "Engine oil + filter; grease chassis", cost_cents: 9500, meter_miles: 108000, next_due_miles: 113000, vendor: "Main shop" },
  // JD 6120M — oil due in ~20 engine hours.
  { unit: "John Deere 6120M", service_date: -120, service_type: "oil-change", description: "Engine oil + hydraulic filter", cost_cents: 12400, meter_hours: 2350, next_due_hours: 2500, vendor: "Prairie Implement" },
  // Kubota M7060 — recently serviced, comfortable margin.
  { unit: "Kubota M7060", service_date: -90, service_type: "scheduled", description: "500-hr scheduled service", cost_cents: 15800, meter_hours: 1180, next_due_hours: 1500, vendor: "Prairie Implement" },
  // JD 8320R — hydraulic/engine-oil service due NOW at current 6,100 hrs.
  { unit: "John Deere 8320R", service_date: -200, service_type: "oil-change", description: "Engine oil + filters", cost_cents: 17600, meter_hours: 5500, next_due_hours: 6100, vendor: "Prairie Implement" },
  { unit: "John Deere 8320R", service_date: -2, service_type: "other", description: "Hydraulic pump whine at idle — fluid low/hydraulic service", status: "open", vendor: "Prairie Implement" },
  // JD 568 Baler — knotter service due by date (overdue).
  { unit: "John Deere 568 Baler", service_date: -60, service_type: "scheduled", description: "Knotter / twine-arm pre-cutting service", cost_cents: 6100, meter_hours: 870, next_due_date: 0, vendor: "Ag Service Co." },
  // Hay Squeeze — recent repair.
  { unit: "Hay Squeeze Loader", service_date: -45, service_type: "repair", description: "Replaced burst hydraulic hose", cost_cents: 2875, meter_hours: 1190 },
  // Feed Wagon — recent service, open pitting bit noted for winter.
  { unit: "Feed Wagon", service_date: -35, service_type: "scheduled", description: "Grease bearings; checked auger chain", cost_cents: 1450, meter_hours: 2740 },
  // Palaris Ranger — oil service done, next at 3,400 mi.
  { unit: "Polaris Ranger 1000", service_date: -75, service_type: "oil-change", description: "Engine oil + filter", cost_cents: 3400, meter_miles: 2900, next_due_miles: 3400, vendor: "Atwood Farm Store" },
  // Flatbed trailer — open deck repair (parts on order).
  { unit: "20' Flatbed Utility Trailer", service_date: -6, service_type: "repair", description: "Deck board replacement — pressure-treated boards on order", status: "open", vendor: "Big Tex dealer" },
  // Fuel tank — annual inspection upcoming.
  { unit: "500-gal Diesel Bulk Tank", service_date: -200, service_type: "inspection", description: "Annual tank/pump inspection", cost_cents: 19500, next_due_date: 120, vendor: "West Texas Fuel" },
];

/** Deterministic ~30 days of refuels across the fleet, in the units an operator
 * logs at the pump: gallons + total cost per fill, tied to the machine. */
async function seedFuelLog(db: ReturnType<typeof sql>, eqId: Map<string, number>): Promise<number> {
  const get = (name: string) => {
    const id = eqId.get(name);
    if (id == null) throw new Error(`seed fuel references unknown equipment ${name}`);
    return id;
  };
  let n = 0;
  const log = async (
    daysAgo: number,
    unit: string,
    fuelType: string,
    gallons: number,
    pricePerGalCents: number,
    meterHours: number | null,
    meterMiles: number | null,
    location: string,
    notes?: string
  ) => {
    await db`
      INSERT INTO fuel_log (equipment_id, fuel_date, fuel_type, gallons, cost_cents,
                            price_per_gal_cents, meter_hours, meter_miles, location, notes)
      VALUES (${get(unit)}, ${daysFromNow(-daysAgo)}, ${fuelType}, ${gallons},
              ${Math.round(gallons * pricePerGalCents)}, ${pricePerGalCents},
              ${meterHours}, ${meterMiles}, ${location}, ${notes ?? null})`;
    n += 1;
  };

  for (let d = 29; d >= 0; d--) {
    if (rnd(d * 11 + 1) > 0.25) {
      await log(d, "Ford F-350 Service Truck", "diesel", 20 + Math.floor(rnd(d * 11 + 2) * 12),
        359 + Math.floor(rnd(d * 11 + 3) * 8), null, 112400 - (30 - d) * 260, "Pump by shop", "Filled before feed run.");
    }
    if (rnd(d * 13 + 5) > 0.3) {
      await log(d, "Chevy Silverado 2500", "diesel", 16 + Math.floor(rnd(d * 13 + 6) * 10),
        358 + Math.floor(rnd(d * 13 + 7) * 8), null, 84500 - (30 - d) * 210, "Pump by shop");
    }
    if (d % 3 === 0) await log(d, "John Deere 6120M", "diesel", 7 + Math.floor(rnd(d * 17 + 2) * 5), 360, 2480 - (30 - d) * 9, null, "Fuel rack");
    if (d % 4 === 1) await log(d, "John Deere 8320R", "diesel", 18 + Math.floor(rnd(d * 19 + 3) * 14), 359, 6100 - (30 - d) * 16, null, "North shed tank");
    if (d % 5 === 3) await log(d, "Kubota M7060", "diesel", 9 + Math.floor(rnd(d * 23 + 4) * 7), 361, 1320 - (30 - d) * 7, null, "Fuel rack");
    if (d % 4 === 2) await log(d, "Polaris Ranger 1000", "gasoline", 4 + Math.floor(rnd(d * 29 + 5) * 4), 318 + Math.floor(rnd(d * 29 + 6) * 6), null, 3240 - (30 - d) * 28, "Small can by shop", "Utility gas.");
    if (d % 6 === 0) await log(d, "John Deere 568 Baler", "diesel", 24 + Math.floor(rnd(d * 31 + 7) * 18), 360, 890 - (30 - d) * 3, null, "Fuel rack", "Pre-cutting tank fill.");
  }
  return n;
}

/** Seed the equipment/fuel/maintenance module tables. */
async function seedEquipment(
  db: ReturnType<typeof sql>
): Promise<{ equipment: number; maintenance: number; fuel: number }> {
  // Master register: match by name, reuse the existing id (never duplicate).
  const eqId = new Map<string, number>();
  for (const e of EQUIPMENT) {
    let id = await findId(db, "equipment", "name", e.name);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO equipment (name, category, make, model, year, hours, miles, condition, status,
                               location, license_plate, fuel_type, notes)
        VALUES (${e.name}, ${e.category}, ${e.make ?? null}, ${e.model ?? null}, ${e.year ?? null},
                ${e.hours ?? null}, ${e.miles ?? null}, ${e.condition ?? null}, ${e.status},
                ${e.location ?? null}, ${e.license_plate ?? null}, ${e.fuel_type ?? null}, ${e.notes ?? null})
        RETURNING id`;
      id = row.id;
    }
    eqId.set(e.name, id);
  }
  const eqIds = [...eqId.values()];

  // Generated service history + fuel log for the seed fleet: clear exactly the
  // seed-owned rows each run, then re-insert so counts stay stable.
  await db`DELETE FROM maintenance_records WHERE equipment_id IN ${db(eqIds)}`;
  await db`DELETE FROM fuel_log WHERE equipment_id IN ${db(eqIds)}`;

  for (const m of MAINT) {
    const eq = eqId.get(m.unit);
    if (eq == null) throw new Error(`seed maintenance references unknown equipment ${m.unit}`);
    await db`
      INSERT INTO maintenance_records (equipment_id, service_date, service_type, description, cost_cents,
                                       meter_hours, meter_miles, status, next_due_date, next_due_hours,
                                       next_due_miles, vendor)
      VALUES (${eq}, ${daysFromNow(m.service_date)}, ${m.service_type}, ${m.description}, ${m.cost_cents ?? null},
              ${m.meter_hours ?? null}, ${m.meter_miles ?? null}, ${m.status ?? "done"},
              ${m.next_due_date !== undefined ? daysFromNow(m.next_due_date) : null},
              ${m.next_due_hours ?? null}, ${m.next_due_miles ?? null}, ${m.vendor ?? null})`;
  }

  const fuel = await seedFuelLog(db, eqId);
  return { equipment: EQUIPMENT.length, maintenance: MAINT.length, fuel };
}

/** Seed the pasture module tables. Grazing/rest history is generated from each
 * pasture's rotation cycle so the board shows believable days-grazed/rested. */
async function seedPastures(
  db: ReturnType<typeof sql>,
  groupIds: number[]
): Promise<{ pastures: number; assignments: number; grazing: number; observations: number }> {
  // Master rows: match by name and reuse the existing id (never duplicate). This
  // is the fix for the old bug where pastures were INSERTed blindly, so the
  // grazing_log / assignments below could reference ids that didn't exist.
  const pastureId = new Map<string, number>();
  const pastureRows: { p: PastureSeed; id: number }[] = [];
  for (const p of PASTURES) {
    let id = await findId(db, "pastures", "name", p.name);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO pastures (name, size_acres, location, status, soil_type, notes)
        VALUES (${p.name}, ${p.size_acres}, ${p.location}, ${p.status}, ${p.soil_type ?? null}, ${p.notes ?? null})
        RETURNING id`;
      id = row.id;
    }
    pastureId.set(p.name, id);
    pastureRows.push({ p, id });
  }
  const pastureIds = pastureRows.map((r) => r.id);

  // Generated daily history / assignments / observations for the seed pastures:
  // clear exactly the seed-owned rows (their dates are relative to today and
  // regenerated every run) so nothing accumulates across runs, then re-insert.
  await db`DELETE FROM grazing_log WHERE pasture_id IN ${db(pastureIds)}`;
  await db`DELETE FROM pasture_assignments WHERE pasture_id IN ${db(pastureIds)}`;
  await db`DELETE FROM pasture_observations WHERE pasture_id IN ${db(pastureIds)}`;

  let assignments = 0;
  let grazing = 0;

  // 21 days of grazing/rest history from the pasture's rotation cycle.
  for (const { p, id } of pastureRows) {
    for (let d = 20; d >= 0; d--) {
      const cycle = p.graze + p.rest;
      const pos = (d + p.offset) % cycle;
      const status = pos < p.graze ? "grazing" : "rest";
      await db`
        INSERT INTO grazing_log (pasture_id, log_date, status)
        VALUES (${id}, ${daysFromNow(-d)}, ${status})`;
      grazing += 1;
    }
  }

  for (const a of ASSIGNMENTS) {
    const pid = pastureId.get(a.pasture);
    if (pid == null) throw new Error(`seed assignment references unknown pasture ${a.pasture}`);
    await db`
      INSERT INTO pasture_assignments (pasture_id, herd_group_id, assigned_at, target_grazing_days, ended_at, notes)
      VALUES (${pid}, ${a.group !== null ? groupIds[a.group] : null}, ${daysFromNow(a.assigned)},
              ${a.target_days}, ${a.ended !== undefined ? daysFromNow(a.ended) : null}, ${a.notes ?? null})`;
    assignments += 1;
  }

  for (const o of OBSERVATIONS) {
    const pid = pastureId.get(o.pasture);
    if (pid == null) throw new Error(`seed observation references unknown pasture ${o.pasture}`);
    await db`
      INSERT INTO pasture_observations (pasture_id, observed_on, category, note, action_due)
      VALUES (${pid}, ${daysFromNow(o.observed)}, ${o.category}, ${o.note},
              ${o.action_due !== undefined ? daysFromNow(o.action_due) : null})`;
  }

  return { pastures: PASTURES.length, assignments, grazing, observations: OBSERVATIONS.length };
}

// ---- Expenses (0007) -------------------------------------------------------
// A current-month set of realistic expenses spanning the cost-allocation
// dimensions. `day` is a day-of-month that `monthDay()` clamps into the current
// month so the figures always show on the daily dashboard. Idempotency is by
// composite natural key (category + amount + vendor + job): re-running matches
// the already-inserted rows and skips them, so counts stay flat and nothing is
// duplicated even after the seeded dates roll into a fresh month.
type ExpenseSeed = {
  category: "feed" | "vet_health" | "maintenance" | "insurance" | "other";
  day: number; // day-of-month (clamped to the current month & today)
  amount_cents: number;
  vendor: string;
  group?: string;
  pasture?: string;
  equipment?: string;
  job?: string;
  notes?: string;
};
const EXPENSES: ExpenseSeed[] = [
  // Feed — attributed to herd groups, pasture, and the "Feeding" job.
  { category: "feed", day: 5, amount_cents: 124000, vendor: "Chappell Feed & Seed", group: "North Cowherd", pasture: "North River Pasture", job: "Feeding", notes: "20% range cubes + fly-control mineral for the cowherd." },
  { category: "feed", day: 12, amount_cents: 72000, vendor: "Atwood Farm Store", group: "Ewe Flock", pasture: "Lambing Ground", job: "Feeding", notes: "12% sweet feed flushing the ewes." },
  { category: "feed", day: 18, amount_cents: 58500, vendor: "Atwood Farm Store", group: "Browse Crew", pasture: "South Ridge Pasture", job: "Feeding", notes: "Copper-safe sheep & goat mineral top-ups." },
  // Vet & health — attributed to herd groups and a vet vendor.
  { category: "vet_health", day: 7, amount_cents: 235000, vendor: "Cross Timbers Vet", group: "North Cowherd", pasture: "North River Pasture", job: "Vaccination", notes: "Spring blackleg + respiratory vaccine, pour-on fly control." },
  { category: "vet_health", day: 20, amount_cents: 6400, vendor: "Cross Timbers Vet", group: "Ewe Flock", pasture: "Lambing Ground", job: "Hoof care", notes: "Sheep footbath + hoof trimming walk-through." },
  { category: "vet_health", day: 24, amount_cents: 9400, vendor: "Rural Vet Supply", group: "Browse Crew", pasture: "South Ridge Pasture", job: "Health check", notes: "CD-T booster for the goat kids." },
  // Maintenance — attributed to an equipment asset + vendor. This is the
  // ledger representation of repair/parts spend (distinct from the operational
  // maintenance_records log; the dashboard maintenance figure reads expenses).
  { category: "maintenance", day: 9, amount_cents: 128500, vendor: "Prairie Implement", equipment: "John Deere 8320R", job: "Repair", notes: "Hydraulic pump service + engine oil & filters." },
  { category: "maintenance", day: 22, amount_cents: 16700, vendor: "Main shop", equipment: "Chevy Silverado 2500", job: "Repair", notes: "Front brake rotor + pad replacement." },
  { category: "maintenance", day: 15, amount_cents: 6100, vendor: "Ag Service Co.", equipment: "John Deere 568 Baler", job: "Scheduled service", notes: "Knotter / twine-arm pre-cutting service." },
  // Insurance — a monthly insurance line (annual premium spread monthly).
  { category: "insurance", day: 3, amount_cents: 289000, vendor: "T Bar T Insurance", job: "Annual premium", notes: "Property + liability + auto package, monthly portion." },
  { category: "insurance", day: 3, amount_cents: 72000, vendor: "T Bar T Insurance", job: "Equipment coverage", notes: "Fleet & equipment floater, monthly portion." },
  // Other — an uncategorized operating expense to prove the dimension.
  { category: "other", day: 15, amount_cents: 45000, vendor: "Rural Electric Co-op", pasture: "East Hay Meadow", job: "Irrigation", notes: "Center-pivot irrigation power, current month." },
];
/** Seed the expenses ledger idempotently (composite natural key match; insert
 * only when absent). Returns the number of brand-new rows inserted. */
async function seedExpenses(db: ReturnType<typeof sql>): Promise<number> {
  let inserted = 0;
  for (const x of EXPENSES) {
    const groupId = x.group ? await findId(db, "herd_groups", "name", x.group) : null;
    const pastureId = x.pasture ? await findId(db, "pastures", "name", x.pasture) : null;
    const equipId = x.equipment ? await findId(db, "equipment", "name", x.equipment) : null;
    if (x.group && groupId == null) throw new Error(`seed expense references unknown herd group ${x.group}`);
    if (x.pasture && pastureId == null) throw new Error(`seed expense references unknown pasture ${x.pasture}`);
    if (x.equipment && equipId == null) throw new Error(`seed expense references unknown equipment ${x.equipment}`);
    const existing = await db<[{ id: number }]>`
      SELECT id FROM expenses
      WHERE category = ${x.category}
        AND amount_cents = ${x.amount_cents}
        AND vendor = ${x.vendor}
        AND coalesce(job, '') = coalesce(${x.job ?? null}, '')
      LIMIT 1`;
    if (existing.length) continue;
    await db`
      INSERT INTO expenses (expense_date, category, amount_cents, vendor, herd_group_id, pasture_id, equipment_id, job, notes)
      VALUES (${monthDay(x.day)}, ${x.category}, ${x.amount_cents}, ${x.vendor},
              ${groupId}, ${pastureId}, ${equipId}, ${x.job ?? null}, ${x.notes ?? null})`;
    inserted += 1;
  }
  return inserted;
}

// ---- Employees & payroll-lite (0010) ---------------------------------------
// A small believable roster whose monthly labor math is easy to verify by hand
// (e.g. Jesse = 140 h × $18.50 = $2,590). Wage/rate and hours are stored as
// plain numeric values (locale-ready); the labor-cost picture is derived at
// read time. Idempotency is by natural key (name): each worker is inserted
// only when absent, so two consecutive seed runs never duplicate and
// user-added rows are never touched.
type EmployeeSeed = {
  name: string;
  role: string;
  pay_type: "hourly" | "salary" | "contract";
  wage_rate?: number; // USD/hr (hourly)
  hours?: number; // hours logged this period (hourly)
  salary_amount?: number; // monthly gross (salary)
  contract_amount?: number; // monthly contract payment (contract)
  crew: string;
  hire_date: string; // YYYY-MM-DD
  contact: string;
  job: string;
  group?: string; // herd group name to allocate to
  notes?: string;
};
const EMPLOYEES: EmployeeSeed[] = [
  { name: "Jesse Marlow", role: "Ranch hand · feeding & fence", pay_type: "hourly", wage_rate: 18.5, hours: 140, crew: "North crew", hire_date: "2021-04-12", contact: "(555) 210-4471", job: "Feeding", notes: "Hitched on for spring — dependable with the feeding run." },
  { name: "Tomás Reyes", role: "Cowboy / wrangler", pay_type: "hourly", wage_rate: 21, hours: 120, crew: "North crew", hire_date: "2019-08-03", contact: "(555) 881-2034", job: "Gathering", group: "North Cowherd", notes: "Good hand on gathering horseback." },
  { name: "Ruby Whitaker", role: "Herd manager", pay_type: "salary", salary_amount: 4800, crew: "Management", hire_date: "2018-02-20", contact: "ruby.whitaker@tbart.ranch", job: "Management", group: "North Cowherd", notes: "Runs the day-to-day herd, calving, and contract grazing." },
  { name: "Hank Pruitt", role: "Custom baler (contract)", pay_type: "contract", contract_amount: 3200, crew: "Custom ops", hire_date: "2023-06-01", contact: "(555) 320-9910", job: "Hay & forage", notes: "Quarterly custom-baling contract, billed monthly." },
];
/** Seed the employees roster idempotently by natural key (name). Returns the
 * number of brand-new workers inserted (0 on a repeat run). */
async function seedEmployees(db: ReturnType<typeof sql>): Promise<number> {
  let inserted = 0;
  for (const e of EMPLOYEES) {
    const groupId = e.group ? await findId(db, "herd_groups", "name", e.group) : null;
    if (e.group && groupId == null) throw new Error(`seed employee references unknown herd group ${e.group}`);
    const existing = await db<[{ id: number }]>`
      SELECT id FROM employees WHERE name = ${e.name} LIMIT 1`;
    if (existing.length) continue;
    await db`
      INSERT INTO employees (name, role, pay_type, wage_rate, hours, salary_amount,
                             contract_amount, crew, hire_date, contact, job, herd_group_id, notes)
      VALUES (${e.name}, ${e.role}, ${e.pay_type}, ${e.wage_rate ?? null}, ${e.hours ?? null},
              ${e.salary_amount ?? null}, ${e.contract_amount ?? null}, ${e.crew}, ${e.hire_date},
              ${e.contact}, ${e.job}, ${groupId}, ${e.notes ?? null})`;
    inserted += 1;
  }
  return inserted;
}

// ---- Tax & ag-exemption registry (0011) ------------------------------------
// A jurisdiction-aware record of the operation's tax identifiers and
// exemptions. `identifier_number` is TEXT (identifiers, not money) and
// `jurisdiction` is free text (state/province/federal) so any region works —
// not hard-coded to US states. Expiry dates are relative to "today" so the
// upcoming/expired surfacing always lands in the right window regardless of
// when you seed. Idempotency is by natural key (identifier_type + number +
// jurisdiction): each row is inserted only when absent, so two consecutive
// seed runs never duplicate and user-added rows are never touched.
type TaxExemptionSeed = {
  identifier_type: string;
  identifier_number: string;
  jurisdiction: string;
  entity?: string;
  expires_in_days?: number; // omit = never expires
  contact?: string;
  notes?: string;
};
const TAX_EXEMPTIONS: TaxExemptionSeed[] = [
  { identifier_type: "Sales-tax ag exemption", identifier_number: "AG-EX-71042", jurisdiction: "Texas", entity: "T Bar T Ranch", expires_in_days: 620, contact: "State Comptroller ag-exemption desk", notes: "Agriculture sales-and-use tax exemption certificate for feed, seed, fencing, and fuel." },
  { identifier_type: "Employer ID (EIN)", identifier_number: "75-1234567", jurisdiction: "US federal", entity: "T Bar T Ranch", contact: "Payroll (Ruby Whitaker)", notes: "Employer identification number for payroll and 1099s — does not expire." },
  { identifier_type: "Ag-use valuation application", identifier_number: "MVD-2025-0881", jurisdiction: "Texas", entity: "T Bar T Ranch", expires_in_days: 40, contact: "County appraisal district", notes: "1-d-1 open-space valuation renewal — file before the annual deadline to keep the ag valuation." },
  { identifier_type: "Brand registration", identifier_number: "SV 45T", jurisdiction: "Texas", entity: "T Bar T Ranch", expires_in_days: -25, contact: "TDA brand inspection", notes: "Livestock brand registration — EXPIRED, renew to keep brand and inspection rights." },
];
/** Seed the tax/exemption registry idempotently by natural key. Returns the
 * number of brand-new rows inserted (0 on a repeat run). */
async function seedTaxExemptions(db: ReturnType<typeof sql>): Promise<number> {
  let inserted = 0;
  for (const x of TAX_EXEMPTIONS) {
    const existing = await db<[{ id: number }]>`
      SELECT id FROM tax_exemptions
      WHERE identifier_type = ${x.identifier_type}
        AND identifier_number = ${x.identifier_number}
        AND jurisdiction = ${x.jurisdiction}
      LIMIT 1`;
    if (existing.length) continue;
    await db`
      INSERT INTO tax_exemptions (identifier_type, identifier_number, jurisdiction, entity, expires_on, contact, notes)
      VALUES (${x.identifier_type}, ${x.identifier_number}, ${x.jurisdiction}, ${x.entity ?? null},
              ${x.expires_in_days !== undefined ? daysFromNow(x.expires_in_days) : null},
              ${x.contact ?? null}, ${x.notes ?? null})`;
    inserted += 1;
  }
  return inserted;
}

async function seed(): Promise<void> {
  const db = sql();

  // Idempotent + non-destructive seeding. Master rows (herd_groups by name,
  // animals by tag_number, hay by field_or_source, feed by name, pastures by
  // name, equipment by name) are matched by natural key and their existing id
  // reused — never re-inserted as duplicates, so every child row below points
  // at a real, existing parent. The detail/log tables (health_events,
  // usage_log, grazing_log, assignments, observations, maintenance, fuel) are
  // seed-generated rows whose dates are relative to today; we delete exactly
  // the seed-owned rows for those parents and re-insert so counts stay stable
  // across runs. User-added rows under other parents are left untouched.

  // ---- Herd groups (0001) ----
  const groupIds: number[] = [];
  for (const g of GROUPS) {
    let id = await findId(db, "herd_groups", "name", g.name);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO herd_groups (name, species, notes) VALUES (${g.name}, ${g.species}, ${g.notes})
        RETURNING id`;
      id = row.id;
    }
    groupIds.push(id);
  }

  // ---- Animals (0001) ----
  const idByTag = new Map<string, number>();
  const animalIds: number[] = [];
  for (const a of ANIMALS) {
    let id = await findId(db, "animals", "tag_number", a.tag_number!);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO animals (species, name, tag_number, sex, breed, birth_date, status, herd_group_id, pasture, notes)
        VALUES (${a.species}, ${a.name}, ${a.tag_number ?? null}, ${a.sex ?? null}, ${a.breed ?? null},
                ${a.birth_date ?? null}, ${a.status ?? "active"}, ${a.group !== undefined ? groupIds[a.group] : null},
                ${a.pasture ?? null}, ${a.notes ?? null})
        RETURNING id`;
      id = row.id;
    }
    idByTag.set(a.tag_number!, id);
    animalIds.push(id);
  }

  // ---- Health events (0001) ----
  await db`DELETE FROM health_events WHERE animal_id IN ${db(animalIds)}`;
  for (const e of EVENTS) {
    const animalId = idByTag.get(e.tag);
    if (!animalId) throw new Error(`seed event references unknown tag ${e.tag}`);
    await db`
      INSERT INTO health_events (animal_id, event_date, type, description, product, dosage, vet, withdrawal_days, next_due)
      VALUES (${animalId}, ${daysFromNow(e.event_date)}, ${e.type}, ${e.description}, ${e.product ?? null},
              ${e.dosage ?? null}, ${e.vet ?? null}, ${e.withdrawal_days ?? null},
              ${e.next_due !== undefined ? daysFromNow(e.next_due) : null})`;
  }

  // ---- Hay & feed inventory (0002) ----
  const hayIds: number[] = [];
  for (const h of HAY) {
    let id = await findId(db, "hay_inventory", "field_or_source", h.field_or_source);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO hay_inventory (feed_type, cutting, field_or_source, storage_location, quantity, unit, bale_weight_lbs, date_acquired, low_stock_threshold, notes)
        VALUES (${h.feed_type}, ${h.cutting}, ${h.field_or_source}, ${h.storage_location}, ${h.quantity},
                ${h.unit}, ${h.bale_weight_lbs ?? null}, ${daysFromNow(h.acquired)}, ${h.low_stock_threshold}, ${h.notes ?? null})
        RETURNING id`;
      id = row.id;
    }
    hayIds.push(id);
  }

  const feedIds: number[] = [];
  for (const f of FEED) {
    let id = await findId(db, "feed_inventory", "name", f.name);
    if (id == null) {
      const [row] = await db<[{ id: number }]>`
        INSERT INTO feed_inventory (name, category, quantity, unit, supplier, unit_cost_cents, low_stock_threshold, notes)
        VALUES (${f.name}, ${f.category}, ${f.quantity}, ${f.unit}, ${f.supplier ?? null},
                ${f.unit_cost_cents ?? null}, ${f.low_stock_threshold}, ${f.notes ?? null})
        RETURNING id`;
      id = row.id;
    }
    feedIds.push(id);
  }

  // ---- Usage log (0002) ----
  await db`DELETE FROM usage_log WHERE hay_item_id IN ${db(hayIds)} OR feed_item_id IN ${db(feedIds)}`;
  const usageCount = await seedUsage(db, hayIds, feedIds, groupIds);

  // Pasture module (0003) — paddocks, assignments, grazing history, notes.
  const pasture = await seedPastures(db, groupIds);

  // Equipment module (0004) — fleet, maintenance, fuel log.
  const equipment = await seedEquipment(db);
  // Expenses module (0007) — current-month cost ledger.
  const expenses = await seedExpenses(db);
  // Employees & payroll-lite module (0010) — roster.
  const employees = await seedEmployees(db);
  // Tax & ag-exemption registry module (0011) — identifiers & exemptions.
  const taxExemptions = await seedTaxExemptions(db);

  console.log(
    `seeded: ${GROUPS.length} herd groups, ${ANIMALS.length} animals, ${EVENTS.length} health events, ` +
      `${HAY.length} hay stacks, ${FEED.length} feed items, ${usageCount} usage-log entries, ` +
      `${pasture.pastures} pastures, ${pasture.assignments} assignments, ` +
      `${pasture.grazing} grazing days, ${pasture.observations} observations, ` +
      `${equipment.equipment} equipment, ${equipment.maintenance} maintenance records, ` +
      `${equipment.fuel} fuel entries, ${expenses} expense rows, ${employees} employee rows, ` +
      `${taxExemptions} tax/exemption rows`
  );
}

// Run directly: `bun db/seed.ts`
if (import.meta.main) {
  runMigrations()
    .then(seed)
    .then(() => console.log("done"))
    .catch((err) => {
      console.error("seed failed:", err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
