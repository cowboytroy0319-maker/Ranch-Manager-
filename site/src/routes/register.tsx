import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { register } from "~/server/auth";
import { SUBMIT_BTN, AuthFrame, Field, FieldError, useAuthForm } from "~/components/AuthUI";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

export function RegisterPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const { fields, error, busy, setField, submit } = useAuthForm(async (fields) => {
    const res = await register({
      data: { email: fields.email, password: fields.password, ranchName: fields.ranchName },
    });
    if (!res.ok) return res.error;
    await router.invalidate();
    void navigate({ to: "/onboarding", search: { new: "1" } });
    return null;
  });

  return (
    <AuthFrame title="Start your free month" subtitle="One month of Ranch Manager Pro, free — no credit card.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Ranch / operation name" htmlFor="reg-ranch">
          <input
            id="reg-ranch"
            required
            maxLength={80}
            placeholder="e.g. T Bar T Ranch"
            value={fields.ranchName}
            onChange={(e) => setField("ranchName", e.target.value)}
            className={SUBMIT_BTN.input}
          />
        </Field>
        <Field label="Email" htmlFor="reg-email">
          <input
            id="reg-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@yourranch.com"
            value={fields.email}
            onChange={(e) => setField("email", e.target.value)}
            className={SUBMIT_BTN.input}
          />
        </Field>
        <Field label="Password" htmlFor="reg-password">
          <input
            id="reg-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={fields.password}
            onChange={(e) => setField("password", e.target.value)}
            className={SUBMIT_BTN.input}
          />
        </Field>
        <FieldError message={error} />
        <button type="submit" disabled={busy} className={SUBMIT_BTN.btn}>
          {busy ? "Creating your operation…" : "Create my account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-600">
        Already registered?{" "}
        <Link to="/login" search={{ reason: undefined }} className="font-semibold text-green-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}