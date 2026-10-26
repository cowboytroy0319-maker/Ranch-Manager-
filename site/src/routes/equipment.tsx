import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { getSession } from "~/server/auth";
import { AppShell } from "~/components/AppShell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, CardTitle, Stat } from "~/components/ui";
import { TemplatesLink } from "~/components/TemplatesLink";
import { useAddIntent } from "~/components/useAddIntent";
import { getEquipmentData } from "~/server/equipment";
import { EquipmentFormModal } from "~/components/equipment/EquipmentModals";
import {
  FuelEditModal,
  LogFuelModal,
  LogServiceModal,
  ServiceEditModal,
  VoidFuelModal,
  VoidServiceModal,
} from "~/components/equipment/TrackingModals";
import { nextFormOpenKey, responseControlsSheet, TRACKING_ADD_INTENTS, trackingFilterFromSearch } from "~/components/equipment/trackingUI";
import {
  CATEGORY_LABEL,
  assetStatus,
  fmtDollars,
  meterLabel,
  nextDueLabel,
  openRepairCount,
  type EquipmentItem,
  type FuelEntry,
  type MaintenanceRecord,
} from "~/types/equipment";

export const Route = createFileRoute("/equipment")({
  validateSearch: (search: Record<string, unknown>) => trackingFilterFromSearch(search),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
  },

  loader: () => getEquipmentData(),
  component: EquipmentPage,
});

const statusTone = (s: string): "red" | "amber" | "green" =>
  s === "out-of-service" ? "red" : s === "maintenance-due" ? "amber" : "green";

const statusLabel: Record<string, string> = {
  "in-service": "In service",
  "maintenance-due": "Maintenance due",
  "out-of-service": "Out of service",
};

const conditionTone = (c: string | null): "red" | "amber" | "green" =>
  c === "poor" ? "red" : c === "fair" ? "amber" : "green";

function EquipmentPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentItem | null>(null);
  const [fuelSheetOpen, setFuelSheetOpen] = useState(false);
  const [serviceSheetOpen, setServiceSheetOpen] = useState(false);
  // The form-open counters (the 2026-10-26 owner-directed fresh-state fix):
  // EVERY open — sheet button or ?add= deep link — bumps the counter and the
  // modal is keyed by it, so each open is a fresh mount with a fresh form and
  // a fresh client_request_id, and a settled open's late deduped response
  // (the double-tap tail) can never close or overwrite a newer open.
  const [fuelOpenSeq, setFuelOpenSeq] = useState(0);
  const [serviceOpenSeq, setServiceOpenSeq] = useState(0);
  const fuelOpenSeqRef = useRef(0);
  fuelOpenSeqRef.current = fuelOpenSeq;
  const serviceOpenSeqRef = useRef(0);
  serviceOpenSeqRef.current = serviceOpenSeq;
  const [editingFuel, setEditingFuel] = useState<FuelEntry | null>(null);
  const [editingService, setEditingService] = useState<MaintenanceRecord | null>(null);
  const [voidingFuel, setVoidingFuel] = useState<FuelEntry | null>(null);
  const [voidingService, setVoidingService] = useState<MaintenanceRecord | null>(null);
  // The honest result banner (the restock pattern): says which thing happened —
  // expense added, record-only, duplicate, or the server's refusal verbatim.
  const [trackingMessage, setTrackingMessage] = useState<string | null>(null);

  // ?add=service / ?add=fuel (MobileNav Quick Add) land straight on the
  // respective modal — the D7 deep-link fix, same wiring as /expenses.
  const { add, clear: clearAdd } = useAddIntent(TRACKING_ADD_INTENTS);
  // A deep-link (?add=fuel / ?add=service) open is an OPEN: bump its counter
  // so the keyed modal remounts fresh even if a sheet was already showing.
  useEffect(() => {
    if (add === "fuel") setFuelOpenSeq(nextFormOpenKey);
    if (add === "service") setServiceOpenSeq(nextFormOpenKey);
  }, [add]);
  const fuelOpen = fuelSheetOpen || add === "fuel";
  const serviceOpen = serviceSheetOpen || add === "service";
  const closeFuel = () => {
    setFuelSheetOpen(false);
    if (add === "fuel") clearAdd();
  };
  const closeService = () => {
    setServiceSheetOpen(false);
    if (add === "service") clearAdd();
  };

  const board = useMemo(
    () =>
      data.equipment
        .map((e) => ({
          eq: e,
          status: assetStatus(e, data.maintenance),
          nextDue: nextDueLabel(e, data.maintenance),
          open: openRepairCount(e, data.maintenance),
        }))
        .sort((a, b) => priorityRank(a.status) - priorityRank(b.status)),
    [data.equipment, data.maintenance]
  );

  // Overview numbers — the ones an operator actually thinks in.
  const stats = useMemo(() => {
    const total = data.equipment.length;
    const inService = board.filter((b) => b.status === "in-service").length;
    const due = board.filter((b) => b.status === "maintenance-due").length;
    const down = board.filter((b) => b.status === "out-of-service").length;
    const open = board.reduce((s, b) => s + b.open, 0);
    return { total, inService, due, down, open };
  }, [board]);

  const fuel = useMemo(() => {
    const gallons = data.fuel.reduce((s, f) => s + f.gallons, 0);
    // The two-path money rule (0022): only PURCHASES carry spend — a draw's
    // cost, when recorded for economics, is not money (its tank was expensed
    // when bought), so it stays out of the dollar totals. Gallons stay usage.
    const cost = data.fuel.reduce((s, f) => s + (f.record_kind === "draw" ? 0 : f.cost_cents ?? 0), 0);
    const byMachine = new Map<string, { gallons: number; cost: number; fills: number }>();
    for (const f of data.fuel) {
      const key = f.equipment_name ?? "Unassigned / bulk";
      const cur = byMachine.get(key) ?? { gallons: 0, cost: 0, fills: 0 };
      cur.gallons += f.gallons;
      cur.cost += f.record_kind === "draw" ? 0 : f.cost_cents ?? 0;
      cur.fills += 1;
      byMachine.set(key, cur);
    }
    return { gallons, cost, byMachine };
  }, [data.fuel]);

  // States ----------------------------------------------------------------
  if (!data.configured) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
          <CardTitle
            title="🚜 Database not configured"
            sub="Equipment, fuel & maintenance records persist to Postgres — no connection string is set in this environment."
          />
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-stone-700">
            <li>
              Set <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to a Postgres
              connection string.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:migrate</code> to create the
              equipment, fuel, and maintenance tables.
            </li>
            <li>
              Run <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">bun run db:seed</code> to load the demo
              fleet, maintenance history, and fuel log.
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-500">
            Meanwhile, the <Link to="/demo" className="font-semibold text-green-700 hover:text-green-900">interactive demo</Link>{" "}
            shows the same workflows with sample data.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
            <Link to="/demo" className="btn-primary !px-4 !py-2 text-sm">Open demo</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.error) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-red-300 bg-red-50">
          <CardTitle title="Database error" sub="The database is configured but the equipment records could not be read." />
          <pre className="overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-red-800">{data.error}</pre>
          <Link to="/dashboard" className="btn-outline !px-4 !py-2 text-sm">← Daily Ops dashboard</Link>
        </Card>
      </Shell>
    );
  }

  const needingAttention = board.filter((b) => b.status !== "in-service");

  return (
    <Shell>
      {/* Overview — fleet at a glance */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total units" value={String(stats.total)} sub="trucks, tractors, implements" />
        <Stat label="In service" value={String(stats.inService)} sub="ready to run" />
        <Stat
          label="Need attention"
          value={String(stats.due + stats.down)}
          sub={`${stats.due} maintenance · ${stats.down} out of service`}
          accent={stats.due + stats.down > 0}
        />
        <Stat
          label="Open repairs"
          value={String(stats.open)}
          sub="work orders still open"
          accent={stats.open > 0}
        />
      </div>

      {/* Needs attention — the "today" hook */}
      <Card className={needingAttention.length ? "border-amber-200 bg-amber-50/40" : ""}>
        <CardTitle
          title="Needs attention"
          sub={
            needingAttention.length
              ? "Due by hours, miles, or date — or waiting on an open repair"
              : "All equipment is in service"
          }
          right={
            needingAttention.length > 0 ? (
              <Badge tone="amber">{needingAttention.length} to check</Badge>
            ) : (
              <Badge tone="green">All clear</Badge>
            )
          }
        />
        {needingAttention.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing overdue. Fleet is ready to roll. 🎉
          </p>
        ) : (
          <div className="space-y-2">
            {needingAttention.map(({ eq, status, nextDue, open }) => (
              <div
                key={eq.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 bg-white px-3 py-2.5"
              >
                <Badge tone={statusTone(status)}>{statusLabel[status]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{eq.name}</span>
                {nextDue && <span className="text-xs font-semibold text-amber-700">{nextDue}</span>}
                {open > 0 && <span className="text-xs text-stone-500">{open} open repair{open > 1 ? "s" : ""}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Equipment status board */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle title="Equipment & vehicles" sub="Fleet register with meter, condition, and service status" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setEditing(null); setFuelOpenSeq(nextFormOpenKey); setFuelSheetOpen(true); }} className="btn-outline !px-4 !py-2 text-sm">
              ⛽ + Log fuel
            </button>
            <button onClick={() => { setEditing(null); setServiceOpenSeq(nextFormOpenKey); setServiceSheetOpen(true); }} className="btn-outline !px-4 !py-2 text-sm">
              🔧 + Add service
            </button>
            <button onClick={() => { setEditing(null); setAddOpen(true); }} className="btn-primary !px-4 !py-2 text-sm">
              + Add equipment
            </button>
          </div>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Meter</th>
                <th className="py-2 pr-3">Condition</th>
                <th className="py-2 pr-3">Next service</th>
                <th className="py-2 pr-3">Location</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {board.map(({ eq, status, nextDue }) => (
                <tr
                  key={eq.id}
                  className={`transition hover:bg-green-50/50 ${status !== "in-service" ? "bg-amber-50/30" : ""}`}
                >
                  <td className="py-2.5 pr-3">
                    <span className="font-semibold text-stone-900">{eq.name}</span>
                    {(eq.make || eq.model || eq.year) && (
                      <span className="block text-xs text-stone-400">
                        {[eq.year, eq.make, eq.model].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {eq.license_plate && <span className="block text-xs text-stone-400">Plate {eq.license_plate}</span>}
                  </td>
                  <td className="py-2.5 pr-3"><Badge tone="stone">{CATEGORY_LABEL[eq.category] ?? eq.category}</Badge></td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium text-stone-800">
                    {meterLabel(eq)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={conditionTone(eq.condition)}>{eq.condition ?? "—"}</Badge>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-stone-600">
                    {nextDue ? <span className={status === "maintenance-due" ? "font-semibold text-amber-700" : ""}>{nextDue}</span> : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-stone-600">{eq.location ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={statusTone(status)}>{statusLabel[status]}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(eq); }}
                      className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {data.equipment.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-stone-500">
                    No equipment registered yet — add your first unit with “+ Add equipment” above.
                    <TemplatesLink className="mt-3 justify-center" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Fuel usage */}
      <Card>
        <CardTitle
          title="Fuel usage"
          sub={`${data.fuel.length} refuels on record · latest first`}
          right={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setEditing(null); setFuelOpenSeq(nextFormOpenKey); setFuelSheetOpen(true); }} className="btn-outline !px-3 !py-1.5 text-xs">
                ⛽ + Log fuel
              </button>
              <Badge tone="blue">{fuel.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} gal total</Badge>
              <Badge tone="blue">{fmtDollars(fuel.cost)} total</Badge>
            </div>
          }
        />
        {data.fuel.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            No fuel logs yet — log your first fill-up with “+ Log fuel” above.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="overflow-x-auto lg:col-span-2">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Equipment</th>
                    <th className="py-2 pr-3">Gallons</th>
                    <th className="py-2 pr-3">Cost</th>
                    <th className="py-2 pr-3">Location</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.fuel.slice(0, 12).map((f) => (
                    <tr key={f.id} className="transition hover:bg-sky-50/50">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs font-semibold text-stone-500">{f.fuel_date}</td>
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-stone-800">{f.equipment_name ?? "Unassigned"}</span>
                        <span className="ml-1.5 text-xs text-stone-400">{f.fuel_type}</span>
                        {f.record_kind === "draw" && (
                          <span data-testid={`fuel-kind-${f.id}`} className="ml-1.5 rounded bg-stone-200 px-1.5 py-0.5 text-xs font-semibold text-stone-600">
                            tank draw
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-stone-700">
                        {f.gallons.toLocaleString(undefined, { maximumFractionDigits: 1 })} gal
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 font-medium text-stone-800">{fmtDollars(f.cost_cents)}</td>
                      <td className="py-2.5 pr-3 text-stone-600">{f.location ?? "—"}</td>
                      <td className="py-2.5 text-right">
                        <span className="mr-1.5 text-xs text-stone-500" data-testid={`fuel-linked-${f.id}`}>
                          {f.record_kind === "draw"
                            ? "draw · no expense"
                            : f.expense_id != null
                              ? "↳ in Expenses"
                              : f.cost_cents
                                ? "record only"
                                : ""}
                        </span>
                        <button
                          onClick={() => setEditingFuel(f)}
                          className="mr-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setVoidingFuel(f)}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Void
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">By machine</p>
              <div className="mt-3 space-y-2">
                {[...fuel.byMachine.entries()]
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([name, v]) => (
                    <div key={name} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-stone-700">{name}</span>
                      <span className="whitespace-nowrap font-semibold text-stone-800">
                        {fmtDollars(v.cost)}
                      </span>
                      <span className="whitespace-nowrap text-xs text-stone-500">
                        {v.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} gal
                      </span>
                    </div>
                  ))}
              </div>
              <p className="mt-3 text-xs text-stone-400">Powers per-machine fuel cost reporting.</p>
            </div>
          </div>
        )}
      </Card>

      {/* Maintenance history */}
      <Card>
        <CardTitle
          title="Service & maintenance"
          sub={`${data.maintenance.length} records · latest first`}
          right={
            <button onClick={() => { setEditing(null); setServiceOpenSeq(nextFormOpenKey); setServiceSheetOpen(true); }} className="btn-outline !px-3 !py-1.5 text-xs">
              🔧 + Add service
            </button>
          }
        />
        {data.maintenance.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            No service records yet — add your first service with “+ Add service” above.
          </p>
        ) : (
          <div className="mt-2 space-y-4">
            {data.maintenance.some((m) => m.status === "open") && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600">Open repairs</p>
                <div className="space-y-2">
                  {data.maintenance
                    .filter((m) => m.status === "open")
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2.5"
                      >
                        <Badge tone="red">Open</Badge>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                          {unitName(data.equipment, m.equipment_id)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-stone-600">{m.description}</span>
                        {m.vendor && <span className="text-xs text-stone-500">{m.vendor}</span>}
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => setEditingService(m)}
                            className="min-h-11 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setVoidingService(m)}
                            className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Void
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Service history</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Unit</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3 text-right">Cost</th>
                      <th className="py-2 pr-3">Vendor</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.maintenance
                      .filter((m) => m.status === "done")
                      .slice(0, 15)
                      .map((m) => (
                        <tr key={m.id} className="transition hover:bg-green-50/50">
                          <td className="whitespace-nowrap py-2.5 pr-3 text-xs font-semibold text-stone-500">{m.service_date}</td>
                          <td className="py-2.5 pr-3 font-medium text-stone-800">{unitName(data.equipment, m.equipment_id)}</td>
                          <td className="py-2.5 pr-3"><Badge tone="stone">{m.service_type}</Badge></td>
                          <td className="py-2.5 pr-3 text-stone-600">{m.description ?? "—"}</td>
                          <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium text-stone-800">{fmtDollars(m.cost_cents)}</td>
                          <td className="py-2.5 pr-3 text-stone-600">{m.vendor ?? "—"}</td>
                          <td className="py-2.5 text-right">
                            <span className="mr-1.5 text-xs text-stone-500" data-testid={`service-linked-${m.id}`}>
                              {m.expense_id != null ? "↳ in Expenses" : m.cost_cents ? "record only" : ""}
                            </span>
                            <button
                              onClick={() => setEditingService(m)}
                              className="mr-1.5 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:border-green-700 hover:text-green-800"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setVoidingService(m)}
                              className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Void
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Add / edit equipment modal — same wiring as pasture: save → invalidate */}
      {addOpen || editing ? (
        <EquipmentFormModal
          key={editing ? `edit-${editing.id}` : "add-equipment"}
          editing={editing}
          onClose={() => { setEditing(null); setAddOpen(false); }}
          onSaved={() => { setEditing(null); setAddOpen(false); refresh(); }}
        />
      ) : null}

      {/* Log fuel / add service — one-column mobile forms; the result banner
          says which thing happened (expense added, record-only, duplicate, or
          the server's refusal verbatim). Edit/void modals correct a record and
          its SAME linked expense, or remove both halves. */}
      {fuelOpen && (
        <LogFuelModal
          key={`log-fuel-${fuelOpenSeq}`}
          openKey={fuelOpenSeq}
          equipment={data.equipment}
          onClose={closeFuel}
          onSaved={(message, responseKey) => {
            // The current open's response closes the sheet; a settled open's
            // late deduped tail only updates the banner + list.
            if (responseControlsSheet(responseKey, fuelOpenSeqRef.current)) {
              setFuelSheetOpen(false);
              if (add === "fuel") clearAdd();
            }
            setTrackingMessage(message);
            refresh();
          }}
        />
      )}
      {serviceOpen && (
        <LogServiceModal
          key={`log-service-${serviceOpenSeq}`}
          openKey={serviceOpenSeq}
          equipment={data.equipment}
          onClose={closeService}
          onSaved={(message, responseKey) => {
            if (responseControlsSheet(responseKey, serviceOpenSeqRef.current)) {
              setServiceSheetOpen(false);
              if (add === "service") clearAdd();
            }
            setTrackingMessage(message);
            refresh();
          }}
        />
      )}
      {editingFuel && (
        <FuelEditModal
          key={`fuel-edit-${editingFuel.id}`}
          record={editingFuel}
          onClose={() => setEditingFuel(null)}
          onSaved={(message) => { setEditingFuel(null); setTrackingMessage(message); refresh(); }}
        />
      )}
      {editingService && (
        <ServiceEditModal
          key={`service-edit-${editingService.id}`}
          record={editingService}
          onClose={() => setEditingService(null)}
          onSaved={(message) => { setEditingService(null); setTrackingMessage(message); refresh(); }}
        />
      )}
      {voidingFuel && (
        <VoidFuelModal
          key={`fuel-void-${voidingFuel.id}`}
          record={voidingFuel}
          onClose={() => setVoidingFuel(null)}
          onVoided={(message) => { setVoidingFuel(null); setTrackingMessage(message); refresh(); }}
        />
      )}
      {voidingService && (
        <VoidServiceModal
          key={`service-void-${voidingService.id}`}
          record={voidingService}
          onClose={() => setVoidingService(null)}
          onVoided={(message) => { setVoidingService(null); setTrackingMessage(message); refresh(); }}
        />
      )}
      {trackingMessage && (
        <div
          className="fixed inset-x-3 bottom-20 z-[70] sm:left-auto sm:right-6 sm:w-96"
          data-testid="tracking-message"
          role="status"
        >
          <div className="rounded-xl border border-green-200 bg-white px-4 py-3 text-sm font-semibold text-green-900 shadow-xl">
            <span className="mr-1.5">✅</span>
            {trackingMessage}
            <button
              onClick={() => setTrackingMessage(null)}
              className="ml-3 min-h-11 text-stone-400 transition hover:text-stone-700"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function priorityRank(s: string): number {
  return s === "out-of-service" ? 0 : s === "maintenance-due" ? 1 : 2;
}

function unitName(equipment: EquipmentItem[], id: number): string {
  const e = equipment.find((x) => x.id === id);
  return e ? e.name : `#${id}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      badge="Equipment &amp; Fuel"
      eyebrow="Fourth real module · live database"
      title="Equipment, Fuel &amp; Maintenance"
      subtitle="The fleet register, what&apos;s due for service by hours, miles, or date, and where every gallon went — from the shop door."
    >
      {children}
    </AppShell>
  );
}
