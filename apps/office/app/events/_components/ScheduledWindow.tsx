'use client';

import { UK_ZONE_LABEL, displayTime, displayTimeRange } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * A SCHEDULED window, per §1.8: the UK line, plus a second "your time" line
 * when the reader is not in Europe/London — "07:00 – 23:30 UK time /
 * 09:00 – 01:30 your time" (event-board.html, events.html:340).
 *
 * `labelled` prints the words "UK time" on the first line, as the board's
 * headers do. Where a column header already says "(UK time)" — the list,
 * the day rows, the week chips — the cell prints the bare range the
 * wireframe draws, and the reader outside the UK still gets the second line.
 *
 * The first paint is UK-only on both sides (useViewerZone), so the markup
 * matches during hydration; the "your time" line appears once mounted.
 */
export function ScheduledWindow({
  startsAt,
  endsAt,
  labelled = false,
  className,
}: {
  startsAt: Date | string;
  endsAt: Date | string;
  labelled?: boolean;
  className?: string;
}) {
  const zone = useViewerZone();
  const shown = displayTimeRange(new Date(startsAt), new Date(endsAt), zone);
  const primary = labelled ? shown.primary : stripUkLabel(shown.primary);

  return (
    <span className={className}>
      {primary}
      {shown.secondary ? <span className="sub l2">{shown.secondary}</span> : null}
    </span>
  );
}

/** One scheduled instant — a deadline, a confirmation cut-off — same rule. */
export function ScheduledTime({
  at,
  labelled = false,
  withDate = false,
  className,
}: {
  at: Date | string;
  labelled?: boolean;
  withDate?: boolean;
  className?: string;
}) {
  const zone = useViewerZone();
  const shown = displayTime(new Date(at), 'scheduled', zone, withDate);
  return (
    <span className={className}>
      {labelled ? shown.primary : stripUkLabel(shown.primary)}
      {shown.secondary ? <span className="sub l2">{shown.secondary}</span> : null}
    </span>
  );
}

/**
 * An ACTUAL stamp — a check-in or check-out — shows the reader's own clock
 * only, never dual (§1.8; event-board.html "in 18:52 your time").
 */
export function ActualStamp({
  at,
  withDate = false,
  className,
}: {
  at: Date | string;
  withDate?: boolean;
  className?: string;
}) {
  const zone = useViewerZone();
  return (
    <span className={className}>{displayTime(new Date(at), 'actual', zone, withDate).primary}</span>
  );
}

function stripUkLabel(line: string): string {
  return line.endsWith(` ${UK_ZONE_LABEL}`) ? line.slice(0, -(UK_ZONE_LABEL.length + 1)) : line;
}
