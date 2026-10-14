'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

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
  /**
   * The form inside differs from what it opened with (release audit
   * E-M4). Escape, the backdrop and the × then ask "Discard changes?" in
   * the footer instead of closing: Keep editing, or Discard. The caller's
   * own Cancel is an explicit choice and still closes at once.
   */
  dirty?: boolean;
  /**
   * The dialog is a form: the body and footer are wrapped in a real
   * `<form>`, so Enter in a field submits it (release audit m2) — give the
   * primary footer button `type="submit"`, and its `disabled` keeps Enter
   * from submitting an incomplete form too. The browser's own validation
   * bubbles are off (`noValidate`): the caller shows its inline errors.
   */
  onSubmit?: () => void;
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

function isRadio(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio';
}

/**
 * The tab stops, as the browser takes them. A radio group with a checked
 * radio is ONE stop, the checked one: Tab never lands on its unchecked
 * siblings. Counting them would make an unchecked sibling "last", so Tab
 * from a checked radio at the end of the dialog would not wrap.
 */
function tabbable(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]'),
  );
  const checkedGroups = new Set(
    candidates
      .filter((el) => isRadio(el) && el.name && el.checked)
      .map((el) => (el as HTMLInputElement).name),
  );
  return candidates.filter(
    (el) => !(isRadio(el) && el.name && !el.checked && checkedGroups.has(el.name)),
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
  dirty = false,
  onSubmit,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // "Discard changes?" is showing in the footer.
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  if (asking && (!dirty || !open)) setAsking(false);
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
          // A second Escape while asking is "keep editing", not "discard".
          if (askingRef.current) setAsking(false);
          else if (dirtyRef.current) setAsking(true);
          else onCloseRef.current();
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
    if (!dismissibleRef.current) return;
    if (dirtyRef.current) setAsking(true);
    else onCloseRef.current();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!asking) onSubmit?.();
  };

  const confirmBar = (
    <div className="mf discard" role="alertdialog" aria-label="Discard changes?">
      <span className="discard-q">Discard your changes?</span>
      <button type="button" className="btn sm" autoFocus onClick={() => setAsking(false)}>
        Keep editing
      </button>
      <button
        type="button"
        className="btn sm danger"
        onClick={() => {
          setAsking(false);
          onCloseRef.current();
        }}
      >
        Discard
      </button>
    </div>
  );
  const foot = asking ? confirmBar : footer ? <div className="mf">{footer}</div> : null;
  const body = <div className="mb">{children}</div>;

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
        {onSubmit ? (
          <form className="modal-form" noValidate onSubmit={submit}>
            {body}
            {foot}
          </form>
        ) : (
          <>
            {body}
            {foot}
          </>
        )}
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
