// ============================================================================
// Ranch Manager Pro — shared hook that turns a ?add=... query param into an
// "open create flow" intent. Used by every protected module route so a Quick
// Add bottom-nav link (e.g. /feed?add=hay) lands straight on the working
// create modal on the phone.
// ============================================================================
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export function useAddIntent<T extends string>(
  possible: readonly T[]
): { add: T | null; clear: () => void } {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const raw = (search as Record<string, unknown>)?.add;
  const add = typeof raw === "string" && (possible as readonly string[]).includes(raw) ? (raw as T) : null;
  const fired = useRef<T | null>(null);

  // Fire once per intent value; then clear the query so a reload doesn't
  // re-open the modal and the URL stays shareable/clean.
  useEffect(() => {
    if (!add) return;
    if (fired.current === add) return;
    fired.current = add;
  }, [add]);

  const clear = () => {
    fired.current = null;
    void navigate({ search: (prev) => {
      const { add: _drop, ...rest } = (prev as Record<string, unknown>) ?? {};
      return rest as never;
    }, replace: true });
  };

  return { add: fired.current === add ? add : null, clear };
}