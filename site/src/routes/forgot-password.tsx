import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "~/server/passwordReset";
import { SUBMIT_BTN, AuthFrame, Field, FieldError } from "~/components/AuthUI";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await requestPasswordReset({
        data: { email, origin: window.location.origin },
      });
      // ALWAYS the neutral message — never reveals whether the account exists.
      setMessage(res.message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Reset your password"
      subtitle="Enter your account email and we'll send reset instructions."
    >
      {message ? (
        <div className="space-y-4">
          <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {message}
          </p>
          <p className="text-center text-sm text-stone-600">
            <Link to="/login" search={{ reason: undefined }} className="font-semibold text-green-700 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="forgot-email">
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@yourranch.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className={SUBMIT_BTN.input}
            />
          </Field>
          <FieldError message={error} />
          <button type="submit" disabled={busy} className={SUBMIT_BTN.btn}>
            {busy ? "Sending…" : "Send reset instructions"}
          </button>
          <p className="text-center text-sm text-stone-600">
            <Link to="/login" search={{ reason: undefined }} className="font-semibold text-green-700 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
