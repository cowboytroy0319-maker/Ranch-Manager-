import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { login } from "~/server/auth";
import { SUBMIT_BTN, AuthFrame, Field, FieldError, useAuthForm } from "~/components/AuthUI";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: LoginPage,
});

export function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const { reason } = Route.useSearch();
  const { fields, error, busy, setField, submit } = useAuthForm(async (fields) => {
    const res = await login({ data: { email: fields.email, password: fields.password } });
    if (!res.ok) return res.error;
    await router.invalidate();
    void navigate({ to: "/dashboard" });
    return null;
  });

  return (
    <AuthFrame title="Sign in to Ranch Manager Pro" subtitle="Pick up where you left off at the gate.">
      {reason === "auth" && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Please sign in to view that page.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="login-email">
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@yourranch.com"
            value={fields.email}
            onChange={(e) => setField("email", e.target.value)}
            className={SUBMIT_BTN.input}
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Your password"
            value={fields.password}
            onChange={(e) => setField("password", e.target.value)}
            className={SUBMIT_BTN.input}
          />
        </Field>
        <FieldError message={error} />
        <button type="submit" disabled={busy} className={SUBMIT_BTN.btn}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-600">
        New to Ranch Manager Pro?{" "}
        <Link to="/register" className="font-semibold text-green-700 hover:underline">
          Start your free month
        </Link>
      </p>
    </AuthFrame>
  );
}