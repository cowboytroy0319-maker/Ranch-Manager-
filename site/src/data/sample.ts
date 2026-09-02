// ============================================================================
// Ranch Manager Pro — MVP sample data
// ----------------------------------------------------------------------------
// Hard-coded, realistic demonstration data. No database is used for the MVP;
// this file is the single source of truth for the dashboard demo so later
// modules can swap each block for a real API/DB call without touching the UI.
// All values are labeled "sample" in the UI.
// ============================================================================

// --- Sites (multi-site / multi-pasture scale hint) --------------------------
export interface Site {
  id: string;
  name: string;
  type: "ranch" | "farm";
  location: string;
  acres: number;
}

export const SITES: Site[] = [
  { id: "double-c", name: "Double C Ranch", type: "ranch", location: "Kerrville, TX", acres: 1240 },
  { id: "creekview", name: "Creekview Grazing Farm", type: "farm", location: "Mason, TX", acres: 640 },
  { id: "mesa-unit", name: "Mesa Feedlot Unit", type: "ranch", location: "Hereford, TX", acres: 380 },
];

// --- Livestock inventory ----------------------------------------------------
export interface Species {
  key: "cattle" | "horses" | "goats" | "sheep" | "pigs";
  label: string;
  head: number;
  color: string; // hex used in charts
  note: string;
}

export const LIVESTOCK: Species[] = [
  { key: "cattle", label: "Cattle", head: 2140, color: "#6b4f2f", note: "Cow-calf + stockers" },
  { key: "horses", label: "Horses", head: 86, color: "#7c5a3a", note: "Ranch & riding string" },
  { key: "goats", label: "Goats", head: 340, color: "#a8823d", note: "Brush control herd" },
  { key: "sheep", label: "Sheep", head: 205, color: "#c9a664", note: "Registered flock" },
  { key: "pigs", label: "Pigs", head: 72, color: "#8a9a5b", note: "Finishing barn" },
];

export const TOTAL_AU = 1532; // animal units, rough grazing-equivalent total
export const STOCKING_RATE = "0.68 AU/acre";

// --- Horse energy / calorie estimator (workload coefficients) ---------------
// DE (Mcal/day) = coefficient × body weight (kg). Coefficients follow published
// equine energy-requirement approximations (NRC-style).
export interface Workload {
  key: string;
  label: string;
  coefficient: number;
  description: string;
}

export const WORKLOADS: Workload[] = [
  { key: "maintenance", label: "Maintenance / idle", coefficient: 0.0333, description: "Pasture-idle, no regular work" },
  { key: "light", label: "Light work", coefficient: 0.0404, description: "Recreational riding, 1–3 hr/wk" },
  { key: "moderate", label: "Moderate work", coefficient: 0.0475, description: "Regular western/english, 3–5 days/wk" },
  { key: "heavy", label: "Heavy work", coefficient: 0.0546, description: "Daily training or full ranch work" },
  { key: "very-heavy", label: "Very heavy work", coefficient: 0.0617, description: "Racing, eventing, intense conditioning" },
  { key: "breeding", label: "Breeding / late gestation", coefficient: 0.051, description: "Breeding stallion or late-lactating mare" },
];

export const HAY_MCAL_PER_LB = 0.8; // avg grass hay digestible energy
export const GRAIN_MCAL_PER_LB = 1.5; // avg sweet feed / grain mix
export const FORAGE_PCT_BW = 0.018; // baseline forage intake ≈ 1.8% body weight/day

// A sample horse card used to prefill the calculator.
export const SAMPLE_HORSES = [
  { name: "Chief", breed: "American Quarter Horse", weightLb: 1150, workload: "heavy" },
  { name: "Daisy", breed: "Painted mare", weightLb: 980, workload: "moderate" },
  { name: "Sundance", breed: "Gelding", weightLb: 1240, workload: "light" },
];

// --- Hay & feed inventory ---------------------------------------------------
export interface FeedLot {
  item: string;
  type: "Hay" | "Grain" | "Supplement";
  unit: string;
  onHand: number;
  reorderAt: number;
  monthlyUse: number;
  costPerUnit: number;
  vendor: string;
}

export const FEED_INVENTORY: FeedLot[] = [
  { item: "Coastal Bermuda Hay", type: "Hay", unit: "bales", onHand: 412, reorderAt: 350, monthlyUse: 140, costPerUnit: 42, vendor: "Hill Country Hay Co." },
  { item: "Alfalfa Hay", type: "Hay", unit: "bales", onHand: 96, reorderAt: 120, monthlyUse: 60, costPerUnit: 26, vendor: "Rio Verde Alfalfa" },
  { item: "Cracked Corn", type: "Grain", unit: "tons", onHand: 8.4, reorderAt: 10, monthlyUse: 3.2, costPerUnit: 290, vendor: "Panhandle Grain" },
  { item: "Range Cubes (20% CP)", type: "Supplement", unit: "tons", onHand: 3.1, reorderAt: 4, monthlyUse: 1.4, costPerUnit: 430, vendor: "Panhandle Grain" },
  { item: "Mineral / Salt Block", type: "Supplement", unit: "blocks", onHand: 27, reorderAt: 20, monthlyUse: 9, costPerUnit: 18, vendor: "Ag Supply Co-op" },
];

// --- Pastures & grazing -----------------------------------------------------
export interface Pasture {
  id: string;
  name: string;
  siteName: string;
  acres: number;
  forageCondition: "Excellent" | "Good" | "Fair" | "Overgrazed";
  utilization: number; // 0-100 (% of available forage used)
  restDays: number; // days since last grazed
  species: string;
}

export const PASTURES: Pasture[] = [
  { id: "north-pasture", name: "North Pasture", siteName: "Double C Ranch", acres: 320, forageCondition: "Good", utilization: 78, restDays: 42, species: "Bermuda + Native mix" },
  { id: "creek-bottom", name: "Creek Bottom", siteName: "Double C Ranch", acres: 210, forageCondition: "Excellent", utilization: 55, restDays: 6, species: "Bermuda, rye, clover" },
  { id: "cedar-flat", name: "Cedar Flat", siteName: "Double C Ranch", acres: 180, forageCondition: "Fair", utilization: 88, restDays: 0, species: "Native prairie grass" },
  { id: "west-bench", name: "West Bench", siteName: "Creekview Grazing Farm", acres: 120, forageCondition: "Good", utilization: 70, restDays: 21, species: "Tall fescue + orchardgrass" },
  { id: "river-haymeadow", name: "River Hay Meadow", siteName: "Creekview Grazing Farm", acres: 90, forageCondition: "Excellent", utilization: 40, restDays: 14, species: "Orchardgrass, clover" },
  { id: "mesa-pen-3", name: "Feedlot Pen 3", siteName: "Mesa Feedlot Unit", acres: 14, forageCondition: "Good", utilization: 95, restDays: 0, species: "Feedlot (grain-finishing)" },
];

export const GRAZING_SYSTEMS = [
  { id: "rotational", name: "Rotational Grazing", color: "#5a7d3a" },
  { id: "continuous", name: "Single-Pasture (Continuous)", color: "#b28a3a" },
  { id: "feedlot", name: "Feedlot / Confinement", color: "#7a6a52" },
];

// --- Equipment & maintenance ------------------------------------------------
export interface Equipment {
  id: string;
  name: string;
  category: string;
  status: "In service" | "Maintenance due" | "Down";
  nextService: string; // human readable due date
  hours: number;
}

export const EQUIPMENT: Equipment[] = [
  { id: "t1", name: "Kubota M7-172 Tractor", category: "Tractor", status: "In service", nextService: "May 2026", hours: 2410 },
  { id: "t2", name: "John Deere 6130M Tractor", category: "Tractor", status: "Maintenance due", nextService: "Overdue", hours: 3880 },
  { id: "c1", name: "John Deere 9970 Cotton Picker", category: "Harvester", status: "In service", nextService: "Nov 2026", hours: 1520 },
  { id: "truck1", name: "F-350 Flatbed (Diesel)", category: "Vehicle", status: "In service", nextService: "Mar 2026", hours: 61200 },
  { id: "truck2", name: "F-550 Service Truck", category: "Vehicle", status: "Maintenance due", nextService: "Overdue", hours: 88400 },
  { id: "baler1", name: "Vermeer 504 Pro Baler", category: "Hay tool", status: "In service", nextService: "Jun 2026", hours: 940 },
  { id: "feeder1", name: "Hydraulic Bale Feeder Wagon", category: "Feed equip", status: "Down", nextService: "Part on order", hours: 310 },
];

export interface Reminder {
  id: string;
  title: string;
  category: string;
  due: string; // ISO
  daysLeft: number;
  urgent: boolean;
  done: boolean;
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

export const REMINDERS: Reminder[] = [
  { id: "r1", title: "Cow herd pregnancy check (vet)", category: "Livestock", due: daysFromNow(-2), daysLeft: -2, urgent: true, done: false },
  { id: "r2", title: "Equipment registration — F-350", category: "Registration", due: daysFromNow(6), daysLeft: 6, urgent: true, done: false },
  { id: "r3", title: "Brand inspection expires", category: "Compliance", due: daysFromNow(12), daysLeft: 12, urgent: true, done: false },
  { id: "r4", title: "Feedlot ration re-balance (nutritionist)", category: "Feed", due: daysFromNow(18), daysLeft: 18, urgent: false, done: false },
  { id: "r5", title: "Baler annual service", category: "Maintenance", due: daysFromNow(25), daysLeft: 25, urgent: false, done: false },
  { id: "r6", title: "General liability policy renewal", category: "Insurance", due: daysFromNow(34), daysLeft: 34, urgent: false, done: false },
  { id: "r7", title: "Hay barn spring fertilization", category: "Pasture", due: daysFromNow(40), daysLeft: 40, urgent: false, done: false },
  { id: "r8", title: "Cattle health record audit", category: "Compliance", due: daysFromNow(52), daysLeft: 52, urgent: false, done: false },
  { id: "r9", title: "Tractor A oil + filter change", category: "Maintenance", due: daysFromNow(9), daysLeft: 9, urgent: false, done: true },
];

// --- Compliance / registrations / insurance ---------------------------------
export interface ComplianceItem {
  id: string;
  title: string;
  kind: "Registration" | "Inspection" | "Insurance" | "License";
  entity: string;
  renews: string;
  daysLeft: number;
  cost: number;
}

export const COMPLIANCE: ComplianceItem[] = [
  { id: "c1", title: "F-350 license & registration", kind: "Registration", entity: "F-350 Flatbed", renews: "Mar 15, 2026", daysLeft: 22, cost: 128 },
  { id: "c2", title: "Annual tractor inspection", kind: "Inspection", entity: "JD 6130M", renews: "Feb 28, 2026", daysLeft: 7, cost: 90 },
  { id: "c3", title: "General liability policy", kind: "Insurance", entity: "Ranch-wide", renews: "Apr 02, 2026", daysLeft: 41, cost: 6840 },
  { id: "c4", title: "Workers' comp renewal", kind: "Insurance", entity: "All sites", renews: "Apr 15, 2026", daysLeft: 54, cost: 2130 },
  { id: "c5", title: "Feedlot environmental permit", kind: "License", entity: "Mesa Unit", renews: "May 01, 2026", daysLeft: 70, cost: 425 },
  { id: "c6", title: "Livestock brand inspection", kind: "Registration", entity: "Cattle herd", renews: "Feb 20, 2026", daysLeft: -1, cost: 210 },
];

// --- Fuel -------------------------------------------------------------------
export interface FuelRecord {
  month: string;
  gallons: number;
  cost: number;
}

export const FUEL_COST = 3.42; // $/gal avg

export const FUEL_MONTHLY: FuelRecord[] = [
  { month: "Sep", gallons: 2100, cost: 7182 },
  { month: "Oct", gallons: 2450, cost: 8379 },
  { month: "Nov", gallons: 2280, cost: 7798 },
  { month: "Dec", gallons: 1950, cost: 6669 },
  { month: "Jan", gallons: 2320, cost: 7934 },
  { month: "Feb", gallons: 2640, cost: 9029 },
];

export const FUEL_ON_HAND_GALLONS = 1850; // tank storage on hand
export const FUEL_ON_HAND_COST = 6327;

// --- Cost reporting (sample, per category, YTD) -----------------------------
export interface CostCategory {
  label: string;
  ytd: number;
  color: string;
}

export const COSTS_YTD: CostCategory[] = [
  { label: "Feed & Hay", ytd: 48600, color: "#5a7d3a" },
  { label: "Fuel", ytd: 47000, color: "#b28a3a" },
  { label: "Equipment & Parts", ytd: 12400, color: "#6b4f2f" },
  { label: "Vet & Health", ytd: 8900, color: "#7a6a52" },
  { label: "Insurance", ytd: 8970, color: "#8a9a5b" },
  { label: "Supplies & Other", ytd: 5600, color: "#a8734b" },
];

export const TOTAL_YTD = COSTS_YTD.reduce((s, c) => s + c.ytd, 0);

// ============================================================================
// Regional pasture & forage intelligence — sample state: TEXAS
// ============================================================================
export const REGION = {
  state: "Texas",
  climate: "Hot-summer / mild-winter; highly variable rainfall (15–35 in/yr west to east)",
  note: "Sample regional guidance for one state. Live product extends this to every state/region.",
};

export const REGIONAL_BASICS = [
  {
    title: "Water needs",
    body: "Texas summer peak daily water demand runs 15–20 gal/head for cattle, 10–12 gal for horses, and 4–8 gal for sheep and goats. In West Texas, plan for double capacity during 100°F+ stretches; Central/East Texas rely more on natural stock tanks but still need backup troughs. Test water for sulfates and TDS in arid regions.",
  },
  {
    title: "Fertilization schedule",
    body: "Warm-season Bermuda/Bahiagrass: apply N at green-up (Apr–May) 50–80 lb/ac, a second split in June if growing, and balance P & K from a soil test every 2–3 years. Cool-season rye/ryegrass overseeded on dormant Bermuda: 40–60 lb N/ac at planting (Sep–Oct) and again in late winter. Never guess rates — soil test first.",
  },
  {
    title: "Best grass & forage species for the climate",
    body: "Warm-season: Coastal & Tifton 85 Bermudagrass, Bahiagrass, native bluestem/grama, sorghum-sudan. Cool-season (winter overseed): annual ryegrass, cereal rye, oats, and clover for nitrogen. Blends that extend grazing and hedge drought perform best across Texas's east–west rainfall gradient.",
  },
];

export const GRASS_FOR_ANIMAL = [
  {
    species: "Cattle",
    best: "Bermudagrass, Bahiagrass, native mixed-grass prairie",
    body: "Bermuda is the workhorse — high yield, handles heavy stocking and continuous grazing, and good gains on stockers when kept under 8–10 in tall. Native range supports cow-calf on lower inputs. Rotational grazing lifts gains and extends recovery.",
  },
  {
    species: "Horses",
    best: "Orchardgrass, Timothy, Bahiagrass; caution with fescue",
    body: "Horses do best on finer, non-ergot grasses like orchardgrass, Timothy, and Bahiagrass. Avoid endophyte-infected tall fescue — it causes poor performance, reduced blood flow, and foaling problems in mares. Keep horses off lush ryegrass-heavy spring flushes to reduce laminitis risk.",
  },
  {
    species: "Goats",
    best: "Native browse, forbs, blackberry, multiflora rose; grass as secondary",
    body: "Goats are browsers, not grazers — they thrive on brush, weeds, forbs, and tree/shrub leaves and are natural brush-control agents. Provide varied browse; don't force pure-grass paddocks. Goats also do well with rotational browse to prevent over-stripping.",
  },
  {
    species: "Sheep",
    best: "Orchardgrass, fescue (endophyte-friendly for sheep), clover-rich mixed pasture",
    body: "Sheep graze close and select forbs well; a diverse sward of grass, clover, and chicory reduces parasite load (especially important for lambs). Rotational grazing every 2–4 days cuts internal parasite exposure versus continuous stocking.",
  },
];

export const GRAZING_SYSTEM_COMPARISON = [
  {
    name: "Rotational Grazing",
    pros: ["Higher forage efficiency & regrowth", "Better soil health and root depth", "Lower parasite pressure on sheep/goats/horses", "More consistent animal gains"],
    cons: ["Needs fencing, water lines, and paddock management", "More daily labor / planning", "Higher setup cost"],
    best: "Best for farms and ranches that can split paddocks and want maximum forage per acre.",
  },
  {
    name: "Single-Pasture (Continuous)",
    pros: ["Lowest setup and labor", "Animals self-select their own forage", "Simple for smaller, low-stocked operations"],
    cons: ["Overgrazing near water/shelter", "Spotty regrowth and weed pressure", "Lower per-acre carrying capacity"],
    best: "Fine for small herds, irrigated or high-rainfall regions, and low stocking rates.",
  },
  {
    name: "Feedlot / Confinement",
    pros: ["Precise nutrition control and growth", "Tight health/drug management", "Efficient land use"],
    cons: ["High feed and manure-management cost", "Needs consistent water, shade, ventilation", "Health-risk concentration"],
    best: "For operations finishing animals to market weight fast, or where land is scarce.",
  },
];

export const FEEDLOT_NUTRITION = [
  {
    title: "Forage-to-concentrate ratios",
    body: "Step-up programs start animals on a high-forage ration (≈60–70% roughage, 30–40% concentrate) over the first 2 weeks, then step concentrate up ~10% every 3–5 days until finishing on a 85–90% concentrate diet. Too fast a jump causes acidosis and founder; every bunk move needs a grain step-up.",
  },
  {
    title: "Finishing / step-up rations (example)",
    rows: [
      ["Phase", "Roughage", "Concentrate", "Notes"],
      ["Step-up (wk 1–2)", "60–70%", "30–40%", "Long hay + starter grain"],
      ["Transition (wk 3–4)", "40–45%", "55–60%", "Raise grain 10%/3–5 days"],
      ["Finishing (wk 5+)", "10–15%", "85–90%", "Corn-based, 2–3% roughage buffer"],
    ],
  },
  {
    title: "Roughage & management considerations",
    body: "Always keep 2–3% (DM basis) effective fiber in finishing rations to prevent acidosis and maintain rumen health. Provide constant fresh water, shade in summer, and adequate bunk space (≈30 in/head) so timid animals get their share. Monitor for bloat and foot problems at 85%+ concentrate levels.",
  },
];

// ============================================================================
// Daily Operations dashboard — morning-briefing data
// ----------------------------------------------------------------------------
// Sample data backing the "What do I need to do today?" dashboard route.
// ============================================================================

// --- Today's priorities (time-sensitive first, then alerts) ------------------
export interface Priority {
  id: string;
  title: string;
  category: string;
  tone: "red" | "amber" | "blue"; // red = overdue/act now · amber = due soon · blue = upcoming
  detail: string;
}

export const TODAY_PRIORITIES: Priority[] = [
  { id: "p1", title: "Cedar Flat steers — rotate now", category: "Pasture move", tone: "red", detail: "88% utilized · move to Creek Bottom today" },
  { id: "p2", title: "JD 6130M tractor service overdue", category: "Maintenance", tone: "red", detail: "Oil + filters due · 3,880 hrs" },
  { id: "p3", title: "F-550 service truck service overdue", category: "Maintenance", tone: "red", detail: "Service due · 88,400 mi" },
  { id: "p4", title: "Cow-Calf pregnancy check (vet) overdue", category: "Vet / Livestock", tone: "red", detail: "2 days overdue · North Pasture herd" },
  { id: "p5", title: "2025 Steer Lot vaccinations due", category: "Livestock / Health", tone: "amber", detail: "Due in 3 days · Mesa Feedlot Unit" },
  { id: "p6", title: "F-350 registration expires", category: "Registration", tone: "amber", detail: "Expires in 6 days" },
  { id: "p7", title: "Alfalfa hay below reorder point", category: "Feed & Hay", tone: "amber", detail: "96 bales on hand · reorder at 120" },
  { id: "p8", title: "Brand inspection expires", category: "Compliance", tone: "amber", detail: "Expires in 12 days" },
  { id: "p9", title: "General liability policy renewal", category: "Insurance", tone: "blue", detail: "Due in 34 days" },
  { id: "p10", title: "Baler annual service", category: "Maintenance", tone: "blue", detail: "Due in 25 days" },
];

// --- Livestock events this month (snapshot) ---------------------------------
export interface LivestockEvent {
  species: string;
  births: number;
  purchases: number;
  sales: number;
  deaths: number;
  needingAttention: number;
}

export const LIVESTOCK_EVENTS: LivestockEvent[] = [
  { species: "Cattle", births: 34, purchases: 0, sales: 12, deaths: 3, needingAttention: 5 },
  { species: "Horses", births: 1, purchases: 0, sales: 0, deaths: 0, needingAttention: 2 },
  { species: "Goats", births: 8, purchases: 0, sales: 4, deaths: 1, needingAttention: 3 },
  { species: "Sheep", births: 6, purchases: 0, sales: 2, deaths: 0, needingAttention: 1 },
  { species: "Pigs", births: 0, purchases: 18, sales: 10, deaths: 0, needingAttention: 1 },
];

export const TOTAL_NEEDING_ATTENTION = LIVESTOCK_EVENTS.reduce((s, e) => s + e.needingAttention, 0);

// --- Feed & hay snapshot ----------------------------------------------------
export interface FeedSnapshot {
  item: string;
  unit: string;
  onHand: number;
  reorderAt: number;
  monthlyUse: number;
  recentUsage: string; // human-readable recent-usage line
}

export const FEED_SNAPSHOT: FeedSnapshot[] = [
  { item: "Coastal Bermuda Hay", unit: "bales", onHand: 412, reorderAt: 350, monthlyUse: 140, recentUsage: "~36 bales this week" },
  { item: "Alfalfa Hay", unit: "bales", onHand: 96, reorderAt: 120, monthlyUse: 60, recentUsage: "~15 bales this week" },
  { item: "Cracked Corn", unit: "tons", onHand: 8.4, reorderAt: 10, monthlyUse: 3.2, recentUsage: "0.8 tons this week" },
  { item: "Range Cubes (20% CP)", unit: "tons", onHand: 3.1, reorderAt: 4, monthlyUse: 1.4, recentUsage: "0.3 tons this week" },
  { item: "Mineral / Salt Block", unit: "blocks", onHand: 27, reorderAt: 20, monthlyUse: 9, recentUsage: "2 blocks this week" },
];

// --- Pasture assignments (grazing status) -----------------------------------
export interface PastureAssignment {
  pastureId: string;
  livestock: string; // what is grazing (or "Resting / none")
  grazingDays: number; // days grazed on current assignment
  restDays: number; // days since last grazed (0 = grazing now)
  observation: string;
  actionDue?: string;
}

export const PASTURE_ASSIGNMENTS: PastureAssignment[] = [
  { pastureId: "north-pasture", livestock: "Cow-Calf Herd (214)", grazingDays: 12, restDays: 0, observation: "Forage ~50% used; moving soon.", actionDue: "Move to Creek Bottom in 2 days" },
  { pastureId: "creek-bottom", livestock: "Resting", grazingDays: 0, restDays: 6, observation: "Rested and regrowing well." },
  { pastureId: "cedar-flat", livestock: "Steers (180)", grazingDays: 20, restDays: 0, observation: "Utilization high (88%) — overgrazing risk.", actionDue: "Rotate now — overgrazing" },
  { pastureId: "west-bench", livestock: "Registered Sheep Flock (205)", grazingDays: 5, restDays: 0, observation: "Good condition, low parasite pressure." },
  { pastureId: "river-haymeadow", livestock: "Resting (hay cut)", grazingDays: 0, restDays: 14, observation: "Hay cut 2 weeks ago; regrowth on track." },
  { pastureId: "mesa-pen-3", livestock: "Finishing Steer Lot (180)", grazingDays: 0, restDays: 0, observation: "Feedlot — grain-finishing ration." },
];

// --- Calendar (upcoming items) ----------------------------------------------
export interface CalendarItem {
  id: string;
  title: string;
  kind: "Registration" | "Inspection" | "Insurance" | "Vet" | "Planned work";
  date: string;
  site: string;
}

export const CALENDAR: CalendarItem[] = [
  { id: "cal1", title: "Brand inspection", kind: "Registration", date: "Feb 20", site: "Double C Ranch" },
  { id: "cal2", title: "Vet visit — calf scours follow-up", kind: "Vet", date: "Feb 25", site: "Creekview Grazing Farm" },
  { id: "cal3", title: "Annual tractor inspection", kind: "Inspection", date: "Feb 28", site: "Double C Ranch" },
  { id: "cal4", title: "F-350 license & registration", kind: "Registration", date: "Mar 15", site: "Double C Ranch" },
  { id: "cal5", title: "General liability premium due", kind: "Insurance", date: "Apr 02", site: "Ranch-wide" },
  { id: "cal6", title: "Spring fertilization — North & Creek Bottom", kind: "Planned work", date: "Apr 05", site: "Double C Ranch" },
  { id: "cal7", title: "Workers' comp renewal", kind: "Insurance", date: "Apr 15", site: "All sites" },
  { id: "cal8", title: "Feedlot environmental permit", kind: "Registration", date: "May 01", site: "Mesa Feedlot Unit" },
  { id: "cal9", title: "Baler annual service", kind: "Planned work", date: "Jun 03", site: "Creekview Grazing Farm" },
];

export const CALENDAR_KIND_TONE: Record<CalendarItem["kind"], "blue" | "amber" | "green" | "red" | "stone"> = {
  Registration: "blue",
  Inspection: "amber",
  Insurance: "green",
  Vet: "red",
  "Planned work": "stone",
};

// ============================================================================
// Cost allocation — multi-dimensional expense tagging
// ----------------------------------------------------------------------------
// Every expense is assignable to one or more dimensions: entity (ranch/business),
// species, herd/lot, pasture, equipment asset, job/activity, date & vendor, and
// category. Sample transactions demonstrate the tagging model that feeds the
// Costs section of the Daily Operations dashboard.
// ============================================================================

export interface CostTransaction {
  id: string;
  date: string; // "MMM DD"
  vendor: string;
  category: string;
  amount: number;
  entity: string; // ranch / business entity
  species: string; // livestock species ("—" if none)
  herdOrLot: string; // individual animal or herd/lot ("—" if none)
  pasture: string; // pasture ("—" if none)
  equipment: string; // equipment asset ("—" if none)
  job: string; // job / activity (e.g. "Hay Production")
}

export const COST_TRANSACTIONS: CostTransaction[] = [
  { id: "tx1", date: "Feb 03", vendor: "Valero Fuel Stop", category: "Fuel", amount: 684, entity: "Double C Ranch", species: "Cattle", herdOrLot: "—", pasture: "—", equipment: "Kubota M7-172 Tractor", job: "Hay Production" },
  { id: "tx2", date: "Feb 05", vendor: "Valero Fuel Stop", category: "Fuel", amount: 512, entity: "Double C Ranch", species: "Cattle", herdOrLot: "Cow-Calf Herd", pasture: "North Pasture", equipment: "F-350 Flatbed (Diesel)", job: "Feeding" },
  { id: "tx3", date: "Feb 06", vendor: "Hill Country Hay Co.", category: "Feed & Hay", amount: 5240, entity: "Double C Ranch", species: "Cattle", herdOrLot: "Cow-Calf Herd", pasture: "North Pasture", equipment: "—", job: "Feeding" },
  { id: "tx4", date: "Feb 08", vendor: "Panhandle Grain", category: "Feed & Hay", amount: 2860, entity: "Creekview Grazing Farm", species: "Sheep", herdOrLot: "Registered Flock", pasture: "West Bench", equipment: "—", job: "Feeding" },
  { id: "tx5", date: "Feb 09", vendor: "Panhandle Grain", category: "Feed & Hay", amount: 1890, entity: "Mesa Feedlot Unit", species: "Cattle", herdOrLot: "Finishing Lot", pasture: "Mesa Pen 3", equipment: "—", job: "Ration / Feedlot" },
  { id: "tx6", date: "Feb 10", vendor: "Vet Supply Co-op", category: "Vet & Health", amount: 1830, entity: "Mesa Feedlot Unit", species: "Cattle", herdOrLot: "2025 Steer Lot", pasture: "Mesa Pen 3", equipment: "—", job: "Health program" },
  { id: "tx7", date: "Feb 12", vendor: "Dr. Whitfield, DVM", category: "Vet & Health", amount: 900, entity: "Double C Ranch", species: "Cattle", herdOrLot: "Cow-Calf Herd", pasture: "North Pasture", equipment: "—", job: "Herd health" },
  { id: "tx8", date: "Feb 13", vendor: "Cedar Creek Trailer Co.", category: "Equipment & Parts", amount: 1240, entity: "Double C Ranch", species: "—", herdOrLot: "—", pasture: "—", equipment: "Gooseneck Stock Trailer", job: "Livestock hauling" },
  { id: "tx9", date: "Feb 15", vendor: "Ag Parts Direct", category: "Maintenance & Parts", amount: 380, entity: "Double C Ranch", species: "—", herdOrLot: "—", pasture: "—", equipment: "John Deere 6130M Tractor", job: "Preventive service" },
  { id: "tx10", date: "Feb 16", vendor: "Vermeer Dealer", category: "Equipment & Parts", amount: 720, entity: "Creekview Grazing Farm", species: "—", herdOrLot: "—", pasture: "—", equipment: "Vermeer 504 Pro Baler", job: "Hay Production" },
  { id: "tx11", date: "Feb 17", vendor: "Farm Bureau Ins.", category: "Insurance", amount: 1140, entity: "Double C Ranch", species: "—", herdOrLot: "—", pasture: "—", equipment: "F-350 Flatbed (Diesel)", job: "Insurance allocation" },
  { id: "tx12", date: "Feb 17", vendor: "Farm Bureau Ins.", category: "Insurance", amount: 1140, entity: "Double C Ranch", species: "—", herdOrLot: "—", pasture: "—", equipment: "John Deere 6130M Tractor", job: "Insurance allocation" },
  { id: "tx13", date: "Feb 17", vendor: "Farm Bureau Ins.", category: "Insurance", amount: 1140, entity: "Double C Ranch", species: "—", herdOrLot: "—", pasture: "—", equipment: "Gooseneck Stock Trailer", job: "Insurance allocation" },
  { id: "tx14", date: "Feb 18", vendor: "Ag Supply Co-op", category: "Supplies & Other", amount: 640, entity: "Double C Ranch", species: "Cattle", herdOrLot: "—", pasture: "Cedar Flat", equipment: "—", job: "Pasture upkeep" },
  { id: "tx15", date: "Feb 19", vendor: "Ag Supply Co-op", category: "Supplies & Other", amount: 420, entity: "Double C Ranch", species: "Cattle", herdOrLot: "Cow-Calf Herd", pasture: "—", equipment: "—", job: "Herd nutrition" },
];

// --- Current-month operating cost by category -------------------------------
export interface MonthCost {
  category: string;
  amount: number;
  color: string;
}

export const COSTS_MONTH: MonthCost[] = [
  { category: "Fuel", amount: 9029, color: "#b28a3a" },
  { category: "Feed & Hay", amount: 8200, color: "#5a7d3a" },
  { category: "Vet & Health", amount: 2400, color: "#7a6a52" },
  { category: "Maintenance & Parts", amount: 1800, color: "#6b4f2f" },
  { category: "Insurance", amount: 2235, color: "#8a9a5b" },
  { category: "Supplies & Other", amount: 1100, color: "#a8734b" },
];

export const MONTH_TOTAL = COSTS_MONTH.reduce((s, c) => s + c.amount, 0);

export const MONTHLY_COST_PER_HEAD = Math.round(MONTH_TOTAL / 2843); // 2,843 total head
export const MONTHLY_COST_PER_AU = Math.round(MONTH_TOTAL / TOTAL_AU);
export const MONTHLY_COST_PER_ACRE = Math.round(MONTH_TOTAL / 2260); // total grazeable acres
