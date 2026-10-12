'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /** Wide variant for the shift builder and event board dialogs. */
  wide?: boolean;
  /**
   * `false` while the dialog must not be left — a submit in flight, say.
   * Escape, a click on the backdrop and the × all do nothing (the × is
   * rendered disabled, so it says so). The caller's own buttons are the
   * caller's to disable. Defaults to `true`.
   */
  dismissible?: boolean;
}

/** What Tab can land on inside the dialog, in document order. */
const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function tabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]'),
  );
}

/**
 * A modal dialog (`.modal`). While it is open:
 *
 *   - focus moves into it (unless a field inside already took it, e.g. an
 *     autoFocus input) and Tab / Shift+Tab cycle inside it — the page
 *     behind is `aria-modal`, so letting focus walk out there would leave a
 *     keyboard user typing into something they cannot see;
 *   - Escape, the backdrop and the × close it, unless `dismissible={false}`;
 *   - on close, focus goes back to whatever opened it, so the keyboard
 *     path picks up where it left off instead of restarting at the top.
 */
export function Modal({
  open,
  title,
  onClose,
  footer,
  children,
  wide,
  dismissible = true,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose on every render; keep it (and the busy
  // flag) out of the effect deps so typing in a field doesn't re-run the
  // focus below and steal focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // Who opened it, read on the render that opens it. Not in the effect: an
  // autoFocus field inside the dialog takes focus during commit, before any
  // effect runs, and the opener would already be lost.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;

    const onKey = (event: KeyboardEvent) => {
      const dialog = ref.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        if (dismissibleRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = tabbable(dialog);
      if (items.length === 0) {
        // Nothing to move to: stay on the dialog itself.
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first || active === dialog) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus the dialog on open only, and never take focus back from a field
    // that already has it (e.g. an autoFocus input).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      // Back to the opener — if it is still on the page. A row that the
      // dialog's own action removed has nowhere to return to.
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (dismissibleRef.current) onCloseRef.current();
  };

  return (
    <div
      className="modal-back"
      onClick={(event) => {
        // Only a click on the backdrop itself: a drag that started inside
        // the dialog and ended outside it is not a request to leave.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        aria-busy={dismissible ? undefined : true}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mh">
          <h3>{title}</h3>
          <button
            type="button"
            className="btn ghost sm icon"
            aria-label="Close"
            disabled={!dismissible}
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="mb">{children}</div>
        {footer ? <div className="mf">{footer}</div> : null}
      </div>
    </div>
  );
}

export type ToastTone = 'cyan' | 'green' | 'amber' | 'coral' | 'purple';

export function Toast({ tone, children }: { tone?: ToastTone; children: ReactNode }) {
  return (
    <div className={tone ? `toast ${tone}` : 'toast'} role="status" aria-live="polite">
      {children}
    </div>
  );
}
