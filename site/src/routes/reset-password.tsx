import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { resetPassword } from "~/server/passwordReset";
import { SUBMIT_BTN, AuthFrame, Field, FieldError } from "~/components/AuthUI";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetPasswordPage,
});

export function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resetPassword({
        data: { token, email, password, confirm },
      });
      if (!res.ok) {
        setError(res.error ?? "That reset link is invalid or has expired. Please request a new one.");
      } else {
        setDone(res.message ?? "Your password has been reset.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Choose a new password" subtitle="Reset links expire after 45 minutes and work once.">
      {done ? (
        <div className="space-y-4">
          <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {done}
          </p>
          <p className="text-center text-sm text-stone-600">
            <Link to="/login" search={{ reason: undefined }} className="font-semibold text-green-700 hover:underline">
              Sign in with your new password
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {!token && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              This reset link is missing its token. Please request a new one from the{" "}
              <Link to="/forgot-password" className="font-semibold hover:underline">
                forgot-password page
              </Link>
              .
            </p>
          )}
          <Field label="Account email" htmlFor="reset-email">
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourranch.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={SUBMIT_BTN.input}
            />
          </Field>
          <Field label="New password" htmlFor="reset-password">
            <input
              id="reset-password"
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
          <Field label="Confirm new password" htmlFor="reset-confirm">
            <input
              id="reset-confirm"
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
          <button type="submit" disabled={busy || !token} className={SUBMIT_BTN.btn}>
            {busy ? "Resetting…" : "Reset password"}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
