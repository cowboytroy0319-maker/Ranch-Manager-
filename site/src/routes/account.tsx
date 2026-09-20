import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "~/components/AppShell";
import { SUBMIT_BTN, Field, FieldError } from "~/components/AuthUI";
import { changePassword, getSession, logout } from "~/server/auth";

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: typeof search.mode === "string" ? search.mode : undefined,
  }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.authed) throw redirect({ to: "/login", search: { reason: "auth" } });
    return { session };
  },
  component: AccountPage,
});

function AccountPage() {
  const { session } = Route.useRouteContext();
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [showReset, setShowReset] = useState(mode === "reset");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await changePassword({ data: { currentPassword: current, password, confirm } });
      if (!res.ok) {
        setError(res.error ?? "We couldn't change that password. Please try again.");
      } else {
        setDone(res.message ?? "Your password was changed.");
        setCurrent("");
        setPassword("");
        setConfirm("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    await logout();
    await router.invalidate();
    void navigate({ to: "/" });
  };

  return (
    <AppShell
      badge="Account"
      eyebrow="Signed in"
      title="Your account"
      subtitle={session.email ? `Signed in as ${session.email}${session.operationName ? ` · ${session.operationName}` : ""}` : "Manage your sign-in."}
    >
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-stone-900">Sign-in details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Email</dt>
              <dd className="min-w-0 truncate font-medium text-stone-900">{session.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Operation</dt>
              <dd className="min-w-0 truncate font-medium text-stone-900">{session.operationName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Role</dt>
              <dd className="font-medium text-stone-900">{session.role ?? "—"}</dd>
            </div>
          </dl>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setShowReset((v) => !v)}
              aria-expanded={showReset}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
            >
              {showReset ? "Hide password reset" : "Reset password"}
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Log out"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Log out"}
            </button>
          </div>
        </div>

        {showReset && (
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-stone-900">Reset your password</h2>
            <p className="mt-1 text-sm text-stone-600">
              Uses your current sign-in — enter your current password plus the new one twice. Other
              signed-in devices are logged out; this device stays signed in.
            </p>
            {done ? (
              <div className="mt-4 space-y-3">
                <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                  {done}
                </p>
                <button
                  type="button"
                  onClick={() => setDone(null)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
                >
                  Change it again
                </button>
              </div>
            ) : (
              <form onSubmit={submitReset} className="mt-4 space-y-4">
                <Field label="Current password" htmlFor="acct-current">
                  <input
                    id="acct-current"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className={SUBMIT_BTN.input}
                  />
                </Field>
                <Field label="New password" htmlFor="acct-new">
                  <input
                    id="acct-new"
                    type="password"
                    required
                    minLength={8}
                    maxLength={200}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={SUBMIT_BTN.input}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="acct-confirm">
                  <input
                    id="acct-confirm"
                    type="password"
                    required
                    minLength={8}
                    maxLength={200}
                    autoComplete="new-password"
                    placeholder="Repeat the new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={SUBMIT_BTN.input}
                  />
                </Field>
                <FieldError message={error} />
                <button type="submit" disabled={busy} className={SUBMIT_BTN.btn}>
                  {busy ? "Changing…" : "Change password"}
                </button>
              </form>
            )}
            <p className="mt-4 text-center text-sm text-stone-600">
              <Link to="/dashboard" className="font-semibold text-green-700 hover:underline">
                ← Back to Daily Ops
              </Link>
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
