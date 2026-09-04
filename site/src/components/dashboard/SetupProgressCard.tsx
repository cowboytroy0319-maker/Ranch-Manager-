// ============================================================================
// Ranch Manager Pro — "Finish ranch setup" card for the Daily Operations
// dashboard. Shows the onboarding progress (e.g. "3 of 5 steps done") and
// links back to /onboarding until setup is complete; hidden when done.
// ============================================================================
import { Link } from "@tanstack/react-router";
import { Badge, Card } from "~/components/ui";
import type { OnboardingData } from "~/types/onboarding";

export function SetupProgressCard({ data }: { data: OnboardingData }) {
  if (data.setupDone) return null;
  if (!data.configured) return null;

  const total = 5;
  const missing = data.missingSteps?.length ?? 4;
  const done = total - missing;
  const pct = Math.round((done / total) * 100);

  const headlineSteps =
    data.missingSteps && data.missingSteps.length > 0
      ? data.missingSteps
          .map((s) => {
            const labels: Record<string, string> = {
              operation_type: "operation type",
              acres: "acres",
              primary_species: "primary species",
              templates: "templates",
            };
            return labels[s] ?? s;
          })
          .join(", ")
      : "";

  return (
    <Card className="border-green-700/30 bg-green-50/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-green-900">Finish ranch setup — {done} of {total} steps done</p>
            <Badge tone="amber">{pct}%</Badge>
          </div>
          <p className="mt-1 text-sm text-green-800">
            {headlineSteps ? `Next: ${headlineSteps}.` : "Tell us a bit about your operation."} You can skip this and work — it takes about 2 minutes.
          </p>
        </div>
        <Link
          to="/onboarding"
          className="shrink-0 rounded-lg border border-green-700 bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 active:bg-green-900"
        >
          Finish setup →
        </Link>
      </div>
    </Card>
  );
}