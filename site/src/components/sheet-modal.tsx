// ============================================================================
// Ranch Manager Pro — shared create/edit modal shell (bottom sheet on phones,
// centered dialog on desktop) with an OPTIONAL sticky bottom footer bar that
// carries env(safe-area-inset-bottom) padding so iPhone browser chrome never
// covers the Save button. Used by every module's add/edit forms so Quick Add
// reaches a consistent, mobile-first create flow everywhere.
// ============================================================================
import { Card } from "~/components/ui";

export function Modal({
  title,
  sub,
  onClose,
  children,
  wide = false,
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/50 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <Card
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-xl sm:max-h-[90vh] sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <div
          className="shrink-0 border-b border-stone-100 px-4 py-4 sm:px-6"
          onClick={(e) => e.stopPropagation()}
        >
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
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
        {footer && (
          <div
            className="shrink-0 border-t border-stone-100 bg-white px-4 py-3 sm:px-6"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {footer}
          </div>
        )}
      </Card>
    </div>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

export function StickyFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

/** Labeled button row used by every create/edit modal footer. */
export function FooterButtons({
  onCancel,
  onSubmitLabel,
  saving,
  submittingLabel = "Saving…",
  formId,
  disabled = false,
}: {
  onCancel: () => void;
  onSubmitLabel: string;
  saving: boolean;
  submittingLabel?: string;
  formId: string;
  disabled?: boolean;
}) {
  return (
    <StickyFooter>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 sm:w-auto sm:px-5"
      >
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        disabled={saving || disabled}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-5"
      >
        {saving ? submittingLabel : onSubmitLabel}
      </button>
    </StickyFooter>
  );
}