'use client';

import { scheduledWindowLines } from '../view-model';
import { useViewerZone } from './useViewerZone';

/**
 * A scheduled window on the /events screens (§1.8): UK time, plus a second
 * "your time" line when the reader is not in Europe/London.
 *
 * The first paint is UK-only — the server cannot know the reader's zone —
 * and the second line appears once mounted (`useViewerZone`), so the
 * markup is identical on both sides.
 *
 * `suffix` is for places whose column header does not already say the zone
 * (the event board writes "07:00 – 15:00 UK time"); `lineClass` is the
 * second line's class in its context (`sub` in a table, `l2` on the board).
 */
export function ScheduledWindow({
  startsAt,
  endsAt,
  suffix = '',
  className,
  lineClass = 'sub',
}: {
  startsAt: string;
  endsAt: string;
  suffix?: string;
  className?: string;
  lineClass?: string;
}) {
  const zone = useViewerZone();
  const { uk, local } = scheduledWindowLines(new Date(startsAt), new Date(endsAt), zone);
  return (
    <span className={className}>
      {uk}
      {suffix ? ` ${suffix}` : null}
      {local ? <span className={lineClass}>{local}</span> : null}
    </span>
  );
}
