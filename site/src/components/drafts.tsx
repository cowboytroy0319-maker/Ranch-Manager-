// ============================================================================
// Ranch Manager Pro — unsaved-draft preservation (localStorage) for create
// flows. On a phone, losing a half-typed hay stack or expense because a save
// failed (or the tab closed) is the worst case. This hook snapshots the form
// state to localStorage as the operator types, offers "restore" when a draft
// exists, and clears it on a confirmed save. It does NOT claim offline saving
// — the draft is only for recovery in-app; a failed submit shows a clear
// warning that nothing was saved.
// ============================================================================
import { useEffect, useRef, useState } from "react";

export type DraftState = Record<string, unknown>;

const isStorageAvailable = () => {
  try {
    const k = "__rmp_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
};

/** Auto-save `state` to localStorage under `key` whenever it changes (and on
 * unload, in case the tab is killed mid-save). Returns a `clearDraft()`. */
export function useDraftPersistence(key: string, state: DraftState) {
  const cleared = useRef(false);

  useEffect(() => {
    if (!isStorageAvailable()) return;
    if (cleared.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota/private mode — skip silently */
    }
  }, [key, state]);

  const clearDraft = () => {
    cleared.current = true;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return { clearDraft };
}

/** Read a previously-saved draft (returns null when none). */
export function readDraft<T extends DraftState>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Human-friendly draft key for a create flow. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export const draftKey = (flow: string) => `rmp_draft_${slug(flow)}`;

export function DraftRestoreBanner({
  flow,
  onRestore,
}: {
  flow: string;
  onRestore: () => void;

}) {
  const key = draftKey(flow);
  const [has, setHas] = useState<boolean>(() =>
    typeof window !== "undefined" ? readDraft(key) !== null : false
  );
  if (!has) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p className="font-semibold">You have an unsaved draft for this form.</p>
      <p className="mt-1 text-xs text-amber-700">
        It was kept on this device in case the last save didn&apos;t go through — it has not been
        saved to the ranch records yet.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            onRestore();
            setHas(false);
          }}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
        >
          Restore draft
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem(key);
            } catch {
              /* ignore */
            }
            setHas(false);
          }}
          className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
        >
          Discard
        </button>
      </div>
    </div>
  );
}