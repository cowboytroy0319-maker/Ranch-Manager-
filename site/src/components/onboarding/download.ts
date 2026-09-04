// ============================================================================
// Ranch Manager Pro — shared onboarding UI helpers (client-safe).
// downloadTemplateCSV turns a template's CSV text into a real browser
// download (Blob + anchor) — no server route, no raw URL. Used by /onboarding
// and /templates (authenticated pages); the server fn getTemplateCsv does the
// auth check + returns only CSV text (plus the enum-derived templates).
// ============================================================================
import { getTemplateCsv } from "~/server/onboarding";
import type { TemplateSlug } from "~/types/onboarding";

export async function downloadTemplateCSV(slug: TemplateSlug): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await getTemplateCsv({ data: slug });
    if (!res.ok) return { ok: false, error: res.error ?? "Could not download the template." };
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not download the template. Please try again." };
  }
}