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
}

export function Modal({ open, title, onClose, footer, children, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose on every render; keep it out of the effect
  // deps so typing in a field doesn't re-run the focus below and steal focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    // Focus the dialog on open only, and never take focus back from a field
    // that already has it (e.g. an autoFocus input).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-back" onClick={onClose}>
      <div
        ref={ref}
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mh">
          <h3>{title}</h3>
          <button type="button" className="btn ghost sm icon" aria-label="Close" onClick={onClose}>
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
