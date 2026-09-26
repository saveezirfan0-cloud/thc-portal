import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface SaveBarProps {
  /**
   * The form differs from what is saved. Shows "Unsaved changes" (with an
   * amber dot: needs action) unless `status` says something else.
   */
  dirty?: boolean;
  /** Replaces the default status line, e.g. "Saving…". */
  status?: ReactNode;
  /** A second, quieter line: why Save is disabled, what saving will do. */
  hint?: ReactNode;
  /** The actions, primary last: Cancel, then Save. */
  children: ReactNode;
  /** Names the region for assistive technology. */
  label?: string;
  className?: string;
}

/**
 * The save action of a long form, pinned to the bottom of the content area
 * so it never scrolls out of reach (the Shift Builder, /settings).
 *
 * Frosted like the rest of the glass chrome (§10.1) and aware of the phone:
 * below 760px it rides above the Back Office tab bar and the home-indicator
 * inset. It only moves where the action is presented — the buttons passed in
 * keep their own labels, disabled rules and handlers.
 *
 * Place it as the last child of the form's own container: `position: sticky`
 * holds it at the viewport's bottom edge while that container is on screen,
 * and it settles at the container's end when the form is scrolled past.
 */
export function SaveBar({
  dirty = false,
  status,
  hint,
  children,
  label = 'Save changes',
  className,
}: SaveBarProps) {
  const line =
    status ??
    (dirty ? (
      <>
        <span className="dot" aria-hidden="true" />
        Unsaved changes
      </>
    ) : null);
  return (
    <div role="region" aria-label={label} className={clsx('savebar', dirty && 'dirty', className)}>
      <div className="savebar-status" aria-live="polite">
        {line ? <span className="savebar-line">{line}</span> : null}
        {hint ? <span className="savebar-hint">{hint}</span> : null}
      </div>
      <div className="savebar-actions">{children}</div>
    </div>
  );
}
