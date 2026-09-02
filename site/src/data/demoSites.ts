// ============================================================================
// Ranch Manager Pro — Demo ranch datasets (multi-site switcher)
// ----------------------------------------------------------------------------
// The /demo route lets a prospect flip between ranches/operations. Each ranch
// has its OWN internally-consistent dataset so the switch shows believable,
// distinct numbers across every module (livestock, hay/feed, pasture,
// equipment, fuel, compliance, costs). The "all sites" roll-up is computed by
// aggregating every ranch, so it stays coherent with the sum of its parts.
//
// This is demo-only data. It does NOT touch production user data logic.
// ============================================================================

import {
  SITES,
  type ComplianceItem,
  type CostCategory,
  type Equipment,
  type FeedLot,
  type FuelRecord,
  type Pasture,
  type Reminder,
  type Species,
} from "./sample";

// --- Per-species animal-unit (AU) factor for grazing-equivalent math ---------
export const AU_PER_HEAD: Record<Species["key"], number> = {
  cattle: 1.0,
  horses: 1.25,
  goats: 0.2,
  sheep: 0.2,
  pigs: 0.3,
};

export interface SampleHorse {
  name: string;
  breed: string;
  weightLb: number;
  workload: string;
}

export interface DemoSiteData {
  siteId: string; // "all" or a site id
  siteName: string; // display heading for this selection
  acres: number; // grazeable acres for cost-per-acre / stocking math
  livestock: Species[];
  totalHead: number;
  totalAu: number;
  stockingRate: string;
  feedInventory: FeedLot[];
  hayOnHandBales: number;
  pastures: Pasture[];
  equipment: Equipment[];
  compliance: ComplianceItem[];
  reminders: Reminder[];
  fuelCost: number;
  fuelMonthly: FuelRecord[];
  fuelOnHandGallons: number;
  fuelOnHandCost: number;
  costsYtd: CostCategory[];
  totalYtd: number;
  costPerAu: number;
  costPerHead: number;
  costPerAcre: number;
  sampleHorses: SampleHorse[];
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

// Helper: build pasture entries for a ranch (id, name, siteName, acres, ...).
type PastureSeed = [
  id: string,
  name: string,
  acres: number,
  forageCondition: Pasture["forageCondition"],
  utilization: number,
  restDays: number,
  species: string,
];
function pastures(siteName: string, seeds: PastureSeed[]): Pasture[] {
  return seeds.map(([id, name, acres, forageCondition, utilization, restDays, species]) => ({
    id,
    name,
    siteName,
    acres,
    forageCondition,
    utilization,
    restDays,
    species,
  }));
}

// --- RANCH 1: Double C Ranch — cow-calf + riding horses + brush goats --------
const doubleC: Omit<DemoSiteData, "totalHead" | "totalAu" | "totalYtd" | "costPerAu" | "costPerHead" | "costPerAcre" | "hayOnHandBales"> = {
  siteId: "double-c",
  siteName: "Double C Ranch",
  acres: 1240,
  livestock: [
    { key: "cattle", label: "Cattle", head: 214, color: "#6b4f2f", note: "Cow-calf herd + a few stockers" },
    { key: "horses", label: "Horses", head: 24, color: "#7c5a3a", note: "Ranch & riding string" },
    { key: "goats", label: "Goats", head: 60, color: "#a8823d", note: "Brush-control herd" },
    { key: "sheep", label: "Sheep", head: 0, color: "#c9a664", note: "None" },
    { key: "pigs", label: "Pigs", head: 0, color: "#8a9a5b", note: "None" },
  ],
  stockingRate: "0.21 AU/acre",
  feedInventory: [
    { item: "Coastal Bermuda Hay", type: "Hay", unit: "bales", onHand: 210, reorderAt: 180, monthlyUse: 90, costPerUnit: 38, vendor: "Hill Country Hay Co." },
    { item: "Alfalfa Hay", type: "Hay", unit: "bales", onHand: 45, reorderAt: 60, monthlyUse: 25, costPerUnit: 24, vendor: "Rio Verde Alfalfa" },
    { item: "Cracked Corn", type: "Grain", unit: "tons", onHand: 2.0, reorderAt: 3, monthlyUse: 1.0, costPerUnit: 300, vendor: "Panhandle Grain" },
    { item: "Range Cubes (20% CP)", type: "Supplement", unit: "tons", onHand: 1.2, reorderAt: 2, monthlyUse: 0.6, costPerUnit: 420, vendor: "Panhandle Grain" },
    { item: "Mineral / Salt Block", type: "Supplement", unit: "blocks", onHand: 15, reorderAt: 12, monthlyUse: 5, costPerUnit: 18, vendor: "Ag Supply Co-op" },
  ],
  pastures: pastures("Double C Ranch", [
    ["north-pasture", "North Pasture", 320, "Good", 78, 42, "Bermuda + Native mix"],
    ["creek-bottom", "Creek Bottom", 210, "Excellent", 55, 6, "Bermuda, rye, clover"],
    ["cedar-flat", "Cedar Flat", 180, "Fair", 88, 0, "Native prairie grass"],
  ]),
  equipment: [
    { id: "t1", name: "Kubota M7-172 Tractor", category: "Tractor", status: "In service", nextService: "May 2026", hours: 2410 },
    { id: "t2", name: "John Deere 6130M Tractor", category: "Tractor", status: "Maintenance due", nextService: "Overdue", hours: 3880 },
    { id: "truck1", name: "F-350 Flatbed (Diesel)", category: "Vehicle", status: "In service", nextService: "Mar 2026", hours: 61200 },
    { id: "baler1", name: "Vermeer 504 Pro Baler", category: "Hay tool", status: "In service", nextService: "Jun 2026", hours: 940 },
    { id: "feeder1", name: "Hydraulic Bale Feeder Wagon", category: "Feed equip", status: "Down", nextService: "Part on order", hours: 310 },
  ],
  compliance: [
    { id: "dc1", title: "F-350 license & registration", kind: "Registration", entity: "F-350 Flatbed", renews: "Mar 15, 2026", daysLeft: 22, cost: 128 },
    { id: "dc2", title: "Annual tractor inspection", kind: "Inspection", entity: "JD 6130M", renews: "Feb 28, 2026", daysLeft: 7, cost: 90 },
    { id: "dc3", title: "General liability policy", kind: "Insurance", entity: "Ranch-wide", renews: "Apr 02, 2026", daysLeft: 41, cost: 3200 },
    { id: "dc4", title: "Livestock brand inspection", kind: "Registration", entity: "Cattle herd", renews: "Feb 20, 2026", daysLeft: -1, cost: 210 },
  ],
  reminders: [
    { id: "dc-r1", title: "Cow herd pregnancy check (vet)", category: "Livestock", due: daysFromNow(-2), daysLeft: -2, urgent: true, done: false },
    { id: "dc-r2", title: "Equipment registration — F-350", category: "Registration", due: daysFromNow(6), daysLeft: 6, urgent: true, done: false },
    { id: "dc-r3", title: "Brand inspection expires", category: "Compliance", due: daysFromNow(12), daysLeft: 12, urgent: true, done: false },
    { id: "dc-r4", title: "Baler annual service", category: "Maintenance", due: daysFromNow(25), daysLeft: 25, urgent: false, done: false },
    { id: "dc-r5", title: "General liability policy renewal", category: "Insurance", due: daysFromNow(34), daysLeft: 34, urgent: false, done: false },
    { id: "dc-r6", title: "Hay barn spring fertilization", category: "Pasture", due: daysFromNow(40), daysLeft: 40, urgent: false, done: false },
    { id: "dc-r7", title: "Tractor A oil + filter change", category: "Maintenance", due: daysFromNow(9), daysLeft: 9, urgent: false, done: true },
  ],
  fuelCost: 3.42,
  fuelMonthly: [
    { month: "Sep", gallons: 980, cost: 3352 },
    { month: "Oct", gallons: 1120, cost: 3830 },
    { month: "Nov", gallons: 1040, cost: 3557 },
    { month: "Dec", gallons: 900, cost: 3078 },
    { month: "Jan", gallons: 1060, cost: 3625 },
    { month: "Feb", gallons: 1180, cost: 4036 },
  ],
  fuelOnHandGallons: 650,
  fuelOnHandCost: 2223,
  costsYtd: [
    { label: "Feed & Hay", ytd: 18400, color: "#5a7d3a" },
    { label: "Fuel", ytd: 16200, color: "#b28a3a" },
    { label: "Equipment & Parts", ytd: 5400, color: "#6b4f2f" },
    { label: "Vet & Health", ytd: 5200, color: "#7a6a52" },
    { label: "Insurance", ytd: 3200, color: "#8a9a5b" },
    { label: "Supplies & Other", ytd: 1800, color: "#a8734b" },
  ],
  sampleHorses: [
    { name: "Chief", breed: "American Quarter Horse", weightLb: 1150, workload: "heavy" },
    { name: "Daisy", breed: "Painted mare", weightLb: 980, workload: "moderate" },
    { name: "Sundance", breed: "Gelding", weightLb: 1240, workload: "light" },
  ],
};

// --- RANCH 2: Creekview Grazing Farm — horse facility + registered sheep -----
const creekview: Omit<DemoSiteData, "totalHead" | "totalAu" | "totalYtd" | "costPerAu" | "costPerHead" | "costPerAcre" | "hayOnHandBales"> = {
  siteId: "creekview",
  siteName: "Creekview Grazing Farm",
  acres: 640,
  livestock: [
    { key: "cattle", label: "Cattle", head: 0, color: "#6b4f2f", note: "None — grazing farm" },
    { key: "horses", label: "Horses", head: 54, color: "#7c5a3a", note: "Boarding facility + riding string" },
    { key: "goats", label: "Goats", head: 0, color: "#a8823d", note: "None" },
    { key: "sheep", label: "Sheep", head: 240, color: "#c9a664", note: "Registered flock" },
    { key: "pigs", label: "Pigs", head: 0, color: "#8a9a5b", note: "None" },
  ],
  stockingRate: "0.18 AU/acre",
  feedInventory: [
    { item: "Orchardgrass Hay", type: "Hay", unit: "bales", onHand: 320, reorderAt: 280, monthlyUse: 110, costPerUnit: 45, vendor: "Lost Pines Forage" },
    { item: "Alfalfa Hay", type: "Hay", unit: "bales", onHand: 90, reorderAt: 80, monthlyUse: 70, costPerUnit: 26, vendor: "Rio Verde Alfalfa" },
    { item: "Sweet Feed (horse)", type: "Grain", unit: "tons", onHand: 4.5, reorderAt: 5, monthlyUse: 2.2, costPerUnit: 410, vendor: "Mill Creek Feed" },
    { item: "Creep Feed (lambs)", type: "Grain", unit: "tons", onHand: 1.6, reorderAt: 2, monthlyUse: 0.8, costPerUnit: 380, vendor: "Mill Creek Feed" },
    { item: "Mineral / Salt Block", type: "Supplement", unit: "blocks", onHand: 20, reorderAt: 15, monthlyUse: 7, costPerUnit: 18, vendor: "Ag Supply Co-op" },
  ],
  pastures: pastures("Creekview Grazing Farm", [
    ["west-bench", "West Bench", 120, "Good", 70, 21, "Tall fescue + orchardgrass"],
    ["river-haymeadow", "River Hay Meadow", 90, "Excellent", 40, 14, "Orchardgrass, clover"],
    ["horse-paddocks", "Bluegrass Horse Paddocks", 28, "Good", 72, 7, "Kentucky bluegrass paddock"],
  ]),
  equipment: [
    { id: "cv1", name: "Vermeer 504 Pro Baler", category: "Hay tool", status: "In service", nextService: "Jun 2026", hours: 940 },
    { id: "cv2", name: "John Deere 5065E Tractor", category: "Tractor", status: "In service", nextService: "May 2026", hours: 1820 },
    { id: "cv3", name: "Nissan Titan 4x4", category: "Vehicle", status: "Maintenance due", nextService: "Overdue", hours: 72600 },
    { id: "cv4", name: "Bush Hog Rotary Mower", category: "Field tool", status: "In service", nextService: "Jul 2026", hours: 410 },
    { id: "cv5", name: "2-Horse LQ Trailer", category: "Vehicle", status: "In service", nextService: "Apr 2026", hours: 1240 },
  ],
  compliance: [
    { id: "cv1", title: "2-Horse trailer license & registration", kind: "Registration", entity: "2-Horse LQ Trailer", renews: "Apr 10, 2026", daysLeft: 48, cost: 96 },
    { id: "cv2", title: "Equine boarding insurance policy", kind: "Insurance", entity: "Horse facility", renews: "May 01, 2026", daysLeft: 70, cost: 4800 },
    { id: "cv3", title: "General liability policy", kind: "Insurance", entity: "Farm-wide", renews: "Apr 02, 2026", daysLeft: 41, cost: 2100 },
    { id: "cv4", title: "Sheep flock health inspection", kind: "Inspection", entity: "Registered flock", renews: "Mar 05, 2026", daysLeft: 12, cost: 150 },
  ],
  reminders: [
    { id: "cv-r1", title: "2-Horse trailer registration renewal", category: "Registration", due: daysFromNow(12), daysLeft: 12, urgent: true, done: false },
    { id: "cv-r2", title: "Sheep flock vet / OPP screening", category: "Livestock", due: daysFromNow(5), daysLeft: 5, urgent: true, done: false },
    { id: "cv-r3", title: "Equine insurance policy renewal", category: "Insurance", due: daysFromNow(34), daysLeft: 34, urgent: false, done: false },
    { id: "cv-r4", title: "Baler annual service", category: "Maintenance", due: daysFromNow(25), daysLeft: 25, urgent: false, done: false },
    { id: "cv-r5", title: "Horse paddock footing top-up", category: "Pasture", due: daysFromNow(18), daysLeft: 18, urgent: false, done: false },
    { id: "cv-r6", title: "Bush Hog blades sharpen", category: "Maintenance", due: daysFromNow(30), daysLeft: 30, urgent: false, done: true },
  ],
  fuelCost: 3.42,
  fuelMonthly: [
    { month: "Sep", gallons: 640, cost: 2189 },
    { month: "Oct", gallons: 720, cost: 2462 },
    { month: "Nov", gallons: 690, cost: 2360 },
    { month: "Dec", gallons: 600, cost: 2052 },
    { month: "Jan", gallons: 680, cost: 2326 },
    { month: "Feb", gallons: 740, cost: 2531 },
  ],
  fuelOnHandGallons: 420,
  fuelOnHandCost: 1436,
  costsYtd: [
    { label: "Feed & Hay", ytd: 28600, color: "#5a7d3a" },
    { label: "Fuel", ytd: 9800, color: "#b28a3a" },
    { label: "Equipment & Parts", ytd: 3600, color: "#6b4f2f" },
    { label: "Vet & Health", ytd: 6400, color: "#7a6a52" },
    { label: "Insurance", ytd: 6900, color: "#8a9a5b" },
    { label: "Supplies & Other", ytd: 2300, color: "#a8734b" },
  ],
  sampleHorses: [
    { name: "Apollo", breed: "Off-track Thoroughbred", weightLb: 1200, workload: "moderate" },
    { name: "Sugar", breed: "Trakehner mare", weightLb: 1350, workload: "heavy" },
    { name: "Cocoa", breed: "Welsh pony", weightLb: 800, workload: "light" },
  ],
};

// --- RANCH 3: Mesa Feedlot Unit — commercial cattle feedlot -------------------
const mesa: Omit<DemoSiteData, "totalHead" | "totalAu" | "totalYtd" | "costPerAu" | "costPerHead" | "costPerAcre" | "hayOnHandBales"> = {
  siteId: "mesa-unit",
  siteName: "Mesa Feedlot Unit",
  acres: 380,
  livestock: [
    { key: "cattle", label: "Cattle", head: 1800, color: "#6b4f2f", note: "Finishing cattle on feed" },
    { key: "horses", label: "Horses", head: 0, color: "#7c5a3a", note: "None" },
    { key: "goats", label: "Goats", head: 0, color: "#a8823d", note: "None" },
    { key: "sheep", label: "Sheep", head: 0, color: "#c9a664", note: "None" },
    { key: "pigs", label: "Pigs", head: 0, color: "#8a9a5b", note: "None" },
  ],
  stockingRate: "Confinement (n/a)",
  feedInventory: [
    { item: "High-Moisture Corn", type: "Grain", unit: "tons", onHand: 240, reorderAt: 200, monthlyUse: 300, costPerUnit: 210, vendor: "Panhandle Grain" },
    { item: "Flaked Milo", type: "Grain", unit: "tons", onHand: 85, reorderAt: 90, monthlyUse: 120, costPerUnit: 195, vendor: "Panhandle Grain" },
    { item: "Supplement Pellet (Rumensin)", type: "Supplement", unit: "tons", onHand: 12, reorderAt: 10, monthlyUse: 18, costPerUnit: 520, vendor: "Feedlot Nutrition Co." },
    { item: "Grass Hay (roughage)", type: "Hay", unit: "bales", onHand: 900, reorderAt: 800, monthlyUse: 1400, costPerUnit: 30, vendor: "Hereford Hay Growers" },
    { item: "Mineral / Salt Block", type: "Supplement", unit: "blocks", onHand: 40, reorderAt: 30, monthlyUse: 22, costPerUnit: 18, vendor: "Ag Supply Co-op" },
  ],
  pastures: pastures("Mesa Feedlot Unit", [
    ["mesa-pen-3", "Feedlot Pen 3", 14, "Good", 95, 0, "Feedlot (grain-finishing)"],
    ["mesa-pen-4", "Feedlot Pen 4", 12, "Good", 90, 0, "Feedlot (grain-finishing)"],
    ["mesa-receiving", "Receiving Pens", 8, "Fair", 85, 0, "Feedlot (receiving)"],
  ]),
  equipment: [
    { id: "m1", name: "Roto-Mix 620-14 Feed Mixer", category: "Feed equip", status: "In service", nextService: "May 2026", hours: 2140 },
    { id: "m2", name: "Peterbilt 567 Feed Truck", category: "Vehicle", status: "In service", nextService: "Apr 2026", hours: 48200 },
    { id: "m3", name: "CAT 930 Loader", category: "Loader", status: "In service", nextService: "Jun 2026", hours: 3260 },
    { id: "m4", name: "Bobcat Skid Steer", category: "Loader", status: "Maintenance due", nextService: "Overdue", hours: 5140 },
    { id: "m5", name: "Hydraulic Bale Feeder Wagon", category: "Feed equip", status: "In service", nextService: "Mar 2026", hours: 410 },
  ],
  compliance: [
    { id: "m1", title: "Feedlot environmental permit", kind: "License", entity: "Mesa Unit", renews: "May 01, 2026", daysLeft: 70, cost: 425 },
    { id: "m2", title: "Workers' comp renewal", kind: "Insurance", entity: "Feedlot crews", renews: "Apr 15, 2026", daysLeft: 54, cost: 12400 },
    { id: "m3", title: "Livestock brand inspection", kind: "Registration", entity: "Feedlot steers", renews: "Feb 20, 2026", daysLeft: -1, cost: 240 },
    { id: "m4", title: "General liability policy", kind: "Insurance", entity: "Feedlot", renews: "Apr 02, 2026", daysLeft: 41, cost: 5200 },
  ],
  reminders: [
    { id: "m-r1", title: "Feedlot ration re-balance (nutritionist)", category: "Feed", due: daysFromNow(6), daysLeft: 6, urgent: true, done: false },
    { id: "m-r2", title: "Brand inspection expires", category: "Compliance", due: daysFromNow(12), daysLeft: 12, urgent: true, done: false },
    { id: "m-r3", title: "Feedlot environmental permit", category: "Registration", due: daysFromNow(28), daysLeft: 28, urgent: false, done: false },
    { id: "m-r4", title: "Skid steer service overdue", category: "Maintenance", due: daysFromNow(-1), daysLeft: -1, urgent: true, done: false },
    { id: "m-r5", title: "Workers' comp renewal", category: "Insurance", due: daysFromNow(44), daysLeft: 44, urgent: false, done: false },
    { id: "m-r6", title: "Bunk detail sweep — new pen arrival", category: "Feed", due: daysFromNow(2), daysLeft: 2, urgent: true, done: false },
  ],
  fuelCost: 3.42,
  fuelMonthly: [
    { month: "Sep", gallons: 3400, cost: 11628 },
    { month: "Oct", gallons: 3900, cost: 13338 },
    { month: "Nov", gallons: 3650, cost: 12483 },
    { month: "Dec", gallons: 3200, cost: 10944 },
    { month: "Jan", gallons: 3750, cost: 12825 },
    { month: "Feb", gallons: 4150, cost: 14193 },
  ],
  fuelOnHandGallons: 2900,
  fuelOnHandCost: 9918,
  costsYtd: [
    { label: "Feed & Hay", ytd: 182000, color: "#5a7d3a" },
    { label: "Fuel", ytd: 58600, color: "#b28a3a" },
    { label: "Equipment & Parts", ytd: 21400, color: "#6b4f2f" },
    { label: "Vet & Health", ytd: 38500, color: "#7a6a52" },
    { label: "Insurance", ytd: 17600, color: "#8a9a5b" },
    { label: "Supplies & Other", ytd: 9400, color: "#a8734b" },
  ],
  sampleHorses: [
    { name: "Foreman", breed: "Ranch gelding", weightLb: 1200, workload: "moderate" },
    { name: "Bunk", breed: "Quarter Horse", weightLb: 1100, workload: "light" },
    { name: "Dusty", breed: "Utility horse", weightLb: 1050, workload: "light" },
  ],
};

// --- Derive computed fields per ranch ----------------------------------------
function finalize(d: Omit<DemoSiteData, "totalHead" | "totalAu" | "totalYtd" | "costPerAu" | "costPerHead" | "costPerAcre" | "hayOnHandBales">): DemoSiteData {
  const totalHead = d.livestock.reduce((s, x) => s + x.head, 0);
  const totalAu = Math.round(
    d.livestock.reduce((s, x) => s + x.head * AU_PER_HEAD[x.key], 0),
  );
  const totalYtd = d.costsYtd.reduce((s, c) => s + c.ytd, 0);
  const hayOnHandBales = d.feedInventory
    .filter((f) => f.unit === "bales")
    .reduce((s, f) => s + Math.round(f.onHand), 0);
  return {
    ...d,
    totalHead,
    totalAu,
    totalYtd,
    hayOnHandBales,
    costPerAu: Math.round(totalYtd / totalAu),
    costPerHead: Math.round(totalYtd / totalHead),
    costPerAcre: Math.round(totalYtd / d.acres),
  };
}

const DOUBLE_C = finalize(doubleC);
const CREEKVIEW = finalize(creekview);
const MESA = finalize(mesa);

const SITE_DATA: Record<string, DemoSiteData> = {
  "double-c": DOUBLE_C,
  creekview: CREEKVIEW,
  "mesa-unit": MESA,
};

// --- "All sites" roll-up = coherent aggregate of every ranch -----------------
const MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"] as const;

function aggregateAll(): DemoSiteData {
  const ranches = [DOUBLE_C, CREEKVIEW, MESA];

  const speciesKey = (s: Species) => s.key;
  const livestock = (Object.keys(AU_PER_HEAD) as Species["key"][]).map((key) => {
    const present = ranches.map((r) => r.livestock.find((l) => l.key === key)).filter(Boolean) as Species[];
    if (present.length === 0) return { key, label: key === "cattle" ? "Cattle" : key === "horses" ? "Horses" : key === "goats" ? "Goats" : key === "sheep" ? "Sheep" : "Pigs", head: 0, color: "#8a8a8a", note: "None" };
    return {
      key,
      label: present[0].label,
      color: present[0].color,
      note: `${present.map((p) => (p.head > 0 ? p.note.replace(/None/i, "").trim() : "")).filter(Boolean).join(" + ") || "None"}`,
      head: present.reduce((s, p) => s + p.head, 0),
    };
  });

  const costsYtd = ranches[0].costsYtd.map((c) => ({
    label: c.label,
    color: c.color,
    ytd: ranches.reduce((s, r) => s + (r.costsYtd.find((x) => x.label === c.label)?.ytd ?? 0), 0),
  }));

  const fuelMonthly = MONTHS.map((month, i) => ({
    month,
    gallons: ranches.reduce((s, r) => s + r.fuelMonthly[i].gallons, 0),
    cost: ranches.reduce((s, r) => s + r.fuelMonthly[i].cost, 0),
  }));

  const totalHead = ranches.reduce((s, r) => s + r.totalHead, 0);
  const totalAu = ranches.reduce((s, r) => s + r.totalAu, 0);
  const totalYtd = ranches.reduce((s, r) => s + r.totalYtd, 0);
  const acres = ranches.reduce((s, r) => s + r.acres, 0);

  const base: Omit<DemoSiteData, "totalHead" | "totalAu" | "totalYtd" | "costPerAu" | "costPerHead" | "costPerAcre" | "hayOnHandBales"> = {
    siteId: "all",
    siteName: "All sites",
    acres,
    livestock,
    stockingRate: (totalAu / acres).toFixed(2) + " AU/acre",
    feedInventory: ranches.flatMap((r) => r.feedInventory),
    pastures: ranches.flatMap((r) => r.pastures),
    equipment: ranches.flatMap((r) => r.equipment),
    compliance: ranches.flatMap((r) => r.compliance),
    reminders: ranches.flatMap((r) => r.reminders),
    fuelCost: 3.42,
    fuelMonthly,
    fuelOnHandGallons: ranches.reduce((s, r) => s + r.fuelOnHandGallons, 0),
    fuelOnHandCost: ranches.reduce((s, r) => s + r.fuelOnHandCost, 0),
    costsYtd,
    sampleHorses: [...DOUBLE_C.sampleHorses, ...CREEKVIEW.sampleHorses, ...MESA.sampleHorses],
  };

  base.stockingRate = `${(totalAu / acres).toFixed(2)} AU/acre`;
  const hayOnHandBales = base.feedInventory
    .filter((f) => f.unit === "bales")
    .reduce((s, f) => s + Math.round(f.onHand), 0);

  return {
    ...base,
    totalHead,
    totalAu,
    totalYtd,
    hayOnHandBales,
    costPerAu: Math.round(totalYtd / totalAu),
    costPerHead: Math.round(totalYtd / totalHead),
    costPerAcre: Math.round(totalYtd / acres),
  };
}

const ALL = aggregateAll();

/** Resolve the demo dataset for the currently selected site (or the combined roll-up). */
export function getDemoData(siteId: string): DemoSiteData {
  if (siteId === "all" || !SITE_DATA[siteId]) return ALL;
  return SITE_DATA[siteId];
}

// Map used to look up a site's display name for module subheadings.
export const SITES_BY_ID: Record<string, { id: string; name: string }> = Object.fromEntries(
  SITES.map((s) => [s.id, { id: s.id, name: s.name }]),
);
