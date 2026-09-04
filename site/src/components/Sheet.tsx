// ============================================================================
// Ranch Manager Pro — shared mobile-first modal shell (for create flows).
// A bottom-anchored sheet on phones with a STICKY bottom action row:
// - Cancel + Save sit in a sticky bar with env(safe-area-inset-bottom) padding
//   so iPhone browser chrome never covers them.
// - The form scrolls; the action row stays put.
// - Always a labeled Cancel + a labeled Save/Submit (never icon-only).
// ============================================================================

export function SheetModal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/50 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="shrink-0 border-b border-stone-100 px-4 py-4 sm:px-6">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-200 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-stone-900">{title}</h3>
              {sub && <p className="text-sm text-stone-500">{sub}</p>}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div
            className="shrink-0 border-t border-stone-200 bg-white px-4 py-3 sm:px-6"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function StickyFooter({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

export const sheetInputCls =
  "mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-700/20";
export const sheetLabelCls = "block text-xs font-semibold uppercase tracking-wide text-stone-500";