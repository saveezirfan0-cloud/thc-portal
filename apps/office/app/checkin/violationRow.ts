import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

/**
 * The row behaviour of a violation log (§9.5), shared by /checkin and the
 * Shifts tab on /staff/:id — §9.6 says the two are "deliberately identical
 * in behaviour", and the wireframes draw both the same way:
 *
 *   - an UNRESOLVED entry carries the coral bar (`tr.violation`, one bar
 *     down the left of the row, from packages/ui);
 *   - a resolved one is dimmed, and only shown with "Show resolved";
 *   - the WHOLE row opens the detail window (`tr.clickable`), not just the
 *     Details button — and so does the keyboard: the row is focusable and
 *     answers Enter and Space, so it is not a mouse-only target.
 *
 * Keys pressed on something inside the row — the Details button — are that
 * control's own; the row ignores them rather than opening the window twice.
 */
export interface ViolationRowProps {
  className: string;
  style: CSSProperties | undefined;
  tabIndex: 0;
  onClick: (event: MouseEvent<HTMLTableRowElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void;
}

export function violationRowProps(
  entry: { resolved: boolean },
  open: () => void,
  dimmedOpacity = 0.45,
): ViolationRowProps {
  return {
    className: entry.resolved ? 'clickable' : 'violation clickable',
    style: entry.resolved ? { opacity: dimmedOpacity } : undefined,
    tabIndex: 0,
    onClick: () => open(),
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    },
  };
}
