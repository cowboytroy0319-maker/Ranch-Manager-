// ============================================================================
// Ranch Manager Pro — shared hook that turns a ?add=... query param into an
// "open create flow" intent. Used by every protected module route so a Quick
// Add bottom-nav link (e.g. /expenses?add=expense) lands straight on the
// working create modal on the phone.
//
// Implementation note: the fired intent is STATE (not a ref) — setting it must
// re-render, or the consumer never sees the intent and the modal never opens.
// The query param is cleared on demand via clear() so a reload/back-nav
// doesn't re-open the modal.
// ============================================================================
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export function useAddIntent<T extends string>(
  possible: readonly T[]
): { add: T | null; clear: () => void } {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const raw = (search as Record<string, unknown>)?.add;
  const add = typeof raw === "string" && (possible as readonly string[]).includes(raw) ? (raw as T) : null;
  const [fired, setFired] = useState<T | null>(null);

  // Raise the intent once per param value (state change re-renders so the
  // consumer actually receives it).
  useEffect(() => {
    if (!add) return;
    if (fired === add) return;
    setFired(add);
  }, [add, fired]);

  const clear = () => {
    setFired(null);
    void navigate({ search: (prev) => {
      const { add: _drop, ...rest } = (prev as Record<string, unknown>) ?? {};
      return rest as never;
    }, replace: true });
  };

  return { add: fired === add ? add : null, clear };
}
