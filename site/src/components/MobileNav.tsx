// ============================================================================
// Ranch Manager Pro — mobile bottom navigation (persistent on phones).
// Dashboard | Tasks | Quick Add | More. Quick Add opens a sheet with every
// create/record flow; More exposes the remaining modules. Shown only on
// small screens (md:hidden); desktop keeps the AppShell top nav. Tap targets
// are ≥44px with labeled text (never icon-only).
// ============================================================================
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";

const BOTTOM_NAV = [
  { to: "/dashboard", label: "Dashboard", emoji: "🌅" },
  { to: "/tasks", label: "Tasks", emoji: "✅" },
] as const;

export const MORE_NAV = [
  { to: "/livestock", label: "Livestock", emoji: "🐄" },
  { to: "/feed", label: "Feed & Hay", emoji: "🌾" },
  { to: "/pasture", label: "Pastures", emoji: "🌿" },
  { to: "/equipment", label: "Equipment", emoji: "🚜" },
  { to: "/expenses", label: "Expenses", emoji: "🧾" },
  { to: "/employees", label: "Employees", emoji: "👷" },
  { to: "/tax-exemptions", label: "Tax Exemptions", emoji: "📄" },
  { to: "/onboarding/import", label: "Import CSV", emoji: "📥" },
  { to: "/onboarding/templates", label: "Templates", emoji: "📋" },
] as const;

/** Serialized localStorage key for the "More" sheet expanded state. */
const MORE_STATE_KEY = "rmp_bottom_more_open";

function useMoreOpen() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(MORE_STATE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(MORE_STATE_KEY, next ? "1" : "0");
      } catch {
        /* private mode etc. — sheet still works for the session */
      }
      return next;
    });
  };
  return { open, toggle };
}

export function QuickAddSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick Add"
    >
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-200" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-stone-900">Quick Add</h3>
            <p className="text-sm text-stone-500">Add or log something in seconds.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100"
            aria-label="Close Quick Add"
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { to: "/livestock?add=animal", label: "Add animal", emoji: "🐄" },
            { to: "/livestock?add=event", label: "Record treatment", emoji: "💉" },
            { to: "/feed?add=hay", label: "Add hay / feed", emoji: "🌾" },
            { to: "/feed?add=usage", label: "Log hay / feed use", emoji: "🍽️" },
            { to: "/pasture?add=pasture", label: "Add pasture", emoji: "🌿" },
            { to: "/equipment?add=equipment", label: "Add equipment", emoji: "🚜" },
            { to: "/equipment?add=fuel", label: "Log fuel / maintenance", emoji: "⛽" },
            { to: "/expenses?add=expense", label: "Add expense", emoji: "🧾" },
            { to: "/tasks?add=task", label: "Add task", emoji: "✅" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-stone-800 transition hover:border-green-700 hover:bg-green-50 active:bg-green-100"
            >
              <span className="text-lg">{item.emoji}</span>
              <span className="min-w-0 text-left">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Persistent mobile bottom nav. On phones this replaces the top-scrolling nav
 * (the hamburger + row are hidden on small screens); desktop is unchanged.
 */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const { open: moreOpen, toggle: toggleMore } = useMoreOpen();
  const [qaOpen, setQaOpen] = useState(false);

  const primary = BOTTOM_NAV.map((item) => {
    const active = pathname === item.to || (item.to === "/dashboard" && pathname === "/");
    return (
      <Link
        key={item.to}
        to={item.to}
        className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition ${
          active ? "text-green-800" : "text-stone-600 hover:bg-stone-100"
        }`}
      >
        <span className="text-lg leading-none">{item.emoji}</span>
        {item.label}
      </Link>
    );
  });

  const isQaActive =
    pathname === "/livestock" ||
    pathname === "/feed" ||
    pathname === "/pasture" ||
    pathname === "/equipment" ||
    pathname === "/expenses" ||
    pathname === "/employees" ||
    pathname === "/tax-exemptions" ||
    pathname.startsWith("/onboarding");

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="App sections"
      >
        <div className="flex items-stretch gap-1 px-2 py-1.5">
          {primary}
          <button
            onClick={() => setQaOpen(true)}
            className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-green-700/40 bg-green-50 px-1 py-1.5 text-[11px] font-semibold text-green-800 transition hover:bg-green-100 active:bg-green-100"
            aria-label="Quick Add"
          >
            <span className="text-lg leading-none">＋</span>
            Quick Add
          </button>
          <button
            onClick={toggleMore}
            aria-label={moreOpen ? "Close more sections" : "Open more sections"}
            aria-expanded={moreOpen}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition ${
              isQaActive || moreOpen ? "text-green-800" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            <span className="text-lg leading-none">☰</span>
            More
          </button>
        </div>
        {moreOpen && (
          <div
            className="grid grid-cols-2 gap-1 border-t border-stone-200 px-2 pt-2 pb-2"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            {MORE_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => toggleMore()}
                className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  pathname === item.to
                    ? "bg-green-800 text-white"
                    : "bg-stone-50 text-stone-700 hover:bg-stone-100"
                }`}
              >
                <span className="text-base">{item.emoji}</span>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
      {qaOpen && <QuickAddSheet onClose={() => setQaOpen(false)} />}
    </>
  );
}

/** Quick Add targets that live on existing protected routes (query-triggered
 * modals). Keep in sync with QuickAddSheet links. */
export const QUICK_ADD_ACTIONS: { path: string; query: string; label: string }[] = [
  { path: "/livestock", query: "add=animal", label: "Add animal" },
  { path: "/livestock", query: "add=event", label: "Record treatment" },
  { path: "/feed", query: "add=hay", label: "Add hay / feed" },
  { path: "/feed", query: "add=usage", label: "Log hay / feed use" },
  { path: "/pasture", query: "add=pasture", label: "Add pasture" },
  { path: "/equipment", query: "add=equipment", label: "Add equipment" },
  { path: "/equipment", query: "add=fuel", label: "Log fuel / maintenance" },
  { path: "/expenses", query: "add=expense", label: "Add expense" },
  { path: "/tasks", query: "add=task", label: "Add task" },
];
export const QUICK_ACTIONS = QUICK_ADD_ACTIONS;