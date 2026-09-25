'use client';

import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * The topbar crumb (§9.5, checkin.html:63): "live monitor · Thu 18 Sep 2026
 * · as of 16:32 your time (14:32 UK) · refreshes every 30 s".
 *
 * The "as of" stamp is the anchor for every Due / check-in comparison on
 * the board, so it is in the reader's zone with the UK clock beside it —
 * and UK-only for a reader already in the UK, exactly as the WINDOW column
 * drops its second line. The date is the UK day, because the monitor is
 * the board for the day of the event (§1.8), whatever the reader's date.
 */
export function MonitorCrumbs({
  asOf,
  shifts,
  unresolved,
}: {
  /** When the board was read — the server render, refreshed every 30 s. */
  asOf: string;
  shifts: number;
  unresolved: number;
}) {
  const zone = useViewerZone();
  const at = new Date(asOf);
  return (
    <>
      live monitor · {ukDayLabel(at)} · as of{' '}
      {needsDualZone(zone) ? (
        <>
          <b>{formatTimeIn(at, zone)} your time</b> ({formatTimeIn(at, UK_ZONE)} UK)
        </>
      ) : (
        <b>{formatTimeIn(at, UK_ZONE)} UK time</b>
      )}{' '}
      · <b>{shifts}</b> {shifts === 1 ? 'shift' : 'shifts'} on the board · <b>{unresolved}</b>{' '}
      unresolved {unresolved === 1 ? 'violation' : 'violations'} · refreshes every 30 s
    </>
  );
}

/** "Thu 18 Sep 2026" in UK terms. */
export function ukDayLabel(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: UK_ZONE,
  }).format(instant);
}
