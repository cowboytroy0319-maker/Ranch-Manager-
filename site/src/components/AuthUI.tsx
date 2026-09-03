// Shared auth page frame + form primitives (login/register routes).
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

export const SUBMIT_BTN = {
  input:
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-stone-900 placeholder-stone-400 focus:border-green-600 focus:ring-2 focus:ring-green-600/30 focus:outline-none",
  btn:
    "w-full rounded-lg bg-green-700 px-4 py-3 font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60",
};

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 via-green-900 to-stone-900 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <Link to="/" className="inline-block">
            <span className="text-3xl">🌾</span>
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-green-100/80">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-green-100/60">
          <Link to="/" className="hover:underline">
            ← Back to Ranch Manager Pro
          </Link>
        </p>
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export type AuthFields = { email: string; password: string; ranchName: string };

export function useAuthForm(onSubmit: (fields: AuthFields) => Promise<string | null>) {
  const [fields, setFields] = useState<AuthFields>({ email: "", password: "", ranchName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setField = (key: keyof AuthFields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (error) setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const err = await onSubmit(fields);
      if (err) setError(err);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return { fields, error, busy, setField, submit };
}