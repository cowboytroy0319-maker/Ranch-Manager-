// ============================================================================
// Ranch Manager Pro — "Download starter templates" reachability link (Part A).
// One shared component used beneath the primary add action in the empty states
// of Livestock, Pastures, Hay & Feed, Equipment, Expenses, and Tasks so the
// /onboarding/templates page (the only template route — never duplicated) is
// reachable from every module a first-time user lands in.
// ============================================================================
import { Link } from "@tanstack/react-router";

export function TemplatesLink({ className = "" }: { className?: string }) {
  return (
    <p className={`text-sm ${className}`}>
      <Link
        to="/onboarding/templates"
        className="inline-flex min-h-11 items-center font-semibold text-green-700 underline underline-offset-2 transition hover:text-green-900"
      >
        ⬇ Download starter templates
      </Link>
      <span className="text-stone-500"> — CSVs for your existing records, ready to import.</span>
    </p>
  );
}
