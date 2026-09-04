// ============================================================================
// Ranch Manager Pro — shared authenticated app shell (app-wide navigation +
// page chrome). Replaces the per-module headers so every protected page offers
// the same nav: a sticky header with the module badge and a mobile-first
// scrollable/hamburger nav with links to every module. Import this from any
// protected route; keep the route's own page content inside <Shell>.
// ============================================================================
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { logout } from "~/server/auth";

export type NavItem = { to: string; label: string; emoji: string };

export const APP_NAV: NavItem[] = [
  { to: "/dashboard", label: "Daily Ops", emoji: "🌅" },
  { to: "/livestock", label: "Livestock", emoji: "🐄" },
  { to: "/feed", label: "Hay & Feed", emoji: "🌾" },
  { to: "/pasture", label: "Pasture", emoji: "🌿" },
  { to: "/equipment", label: "Equipment", emoji: "🚜" },
  { to: "/expenses", label: "Expenses", emoji: "🧾" },
  { to: "/employees", label: "Employees", emoji: "👷" },
  { to: "/tax-exemptions", label: "Tax Exemptions", emoji: "📄" },
  { to: "/tasks", label: "Tasks", emoji: "✅" },
];

export const NOTE_ITEMS = ["/dashboard", "/livestock", "/feed", "/pasture", "/equipment", "/expenses", "/employees", "/tax-exemptions", "/tasks"];

export function isAppPath(path: string): boolean {
  return NOTE_ITEMS.includes(path);
}

/**
 * Shared authenticated shell. `badge` names the current module; `accent`
 * lets a route change the header accent. On phones the nav renders as a
 * horizontally scrollable strip (one row, tap-friendly); the module links
 * are always visible without a hamburger. Includes a link to the marketing
 * site and a sign-out button that clears the session cookie.
 */
export function Shell({
  children,
  badge,
  eyebrow,
  title,
  subtitle,
  accent = false,
}: {
  children: React.ReactNode;
  badge: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    await router.invalidate();
    void navigate({ to: "/" });
  };

  return (
    <div className="min-h-dvh bg-stone-100">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex shrink-0 items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-green-800 text-white">🌾</div>
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-stone-900 sm:text-base">
                Ranch Manager Pro
              </p>
              <span
                className={`mt-0.5 inline-block max-w-[11rem] truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:max-w-none ${
                  accent
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-green-200 bg-green-50 text-green-800"
                }`}
              >
                {badge}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/"
              className="hidden rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 md:inline"
            >
              Site
            </Link>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:border-red-300 hover:text-red-700 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-stone-300 text-stone-600 transition hover:bg-stone-50 md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <span className="text-lg leading-none">{menuOpen ? "✕" : "☰"}</span>
            </button>
          </div>
        </div>
        {/* Nav: on phones this is either a hamburger panel or the scroll row.
            Both are always reachable; large tap targets throughout. */}
        {menuOpen ? (
          <nav className="grid grid-cols-1 gap-1 border-t border-stone-200 px-4 py-3 md:hidden">
            {APP_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-stone-700 transition hover:border-green-700 hover:bg-green-50 active:bg-green-100"
              >
                <span className="text-base">{item.emoji}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : (
          <nav
            className="flex gap-1.5 overflow-x-auto border-t border-stone-200 px-3 py-2 md:px-6"
            aria-label="Modules"
          >
            {APP_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-green-700 hover:bg-green-50 active:bg-green-100"
              >
                <span className="text-base">{item.emoji}</span>
                {item.label}
              </Link>
            ))}
            <Link
              to="/demo"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-500 transition hover:border-green-700 hover:bg-green-50"
            >
              <span className="text-base">🎛️</span> Demo
            </Link>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900 sm:text-4xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">{subtitle}</p>
        </div>
        {children}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Ranch Manager Pro</span>
          <Link to="/dashboard" className="font-medium text-green-700 hover:text-green-900">
            ← Back to the morning briefing
          </Link>
        </footer>
      </main>
    </div>
  );
}
// Alias so routes can import { AppShell } (the shared shell) — the component is `Shell`.
export const AppShell = Shell;
