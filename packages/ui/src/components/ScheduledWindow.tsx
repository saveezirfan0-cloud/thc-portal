'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, formatTimeIn, needsDualZone, viewerZone } from '@thc/domain';

/**
 * The zone the person reading this screen is actually in (§1.8).
 *
 * A worker can be abroad between shifts and the office can be staffed from
 * outside the UK, so a scheduled time must never render as a single
 * unlabelled clock the reader could take for their own. `viewerZone()` reads
 * the browser, which the server cannot know, so the first paint is UK-only
 * and the "your time" line appears once mounted. That keeps the markup
 * identical on both sides — a zone guessed during SSR would be the SERVER's
 * (UTC on Vercel), which is the one reading nobody wants.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}

export interface ScheduledWindowProps {
  startsAt: string | Date;
  endsAt: string | Date;
  /**
   * Between the two clock times. The boards and tables write
   * "17:00 – 23:30"; a dense column may drop the spaces ("17:00–23:30").
   */
  separator?: string;
  /**
   * After the UK line — §1.8's own label, "17:00 – 23:30 UK time". A column
   * whose header already says the zone passes `''`; the event board passes
   * the hours too ("UK time · 8h").
   */
  suffix?: string;
  /**
   * When the suffix shows: only beside a "your time" line (the default, so
   * a reader in the UK sees a plain clock), or always.
   */
  suffixWhen?: 'dual' | 'always';
  className?: string;
  /** The second line's class in its context: `sub` in a table, `l2` on a board. */
  lineClass?: string;
  /**
   * The reader's zone, for previews and snapshots. Otherwise the browser's,
   * read once mounted (`useViewerZone`).
   */
  zone?: string;
}

/**
 * A SCHEDULED window (§1.8): UK time, plus a second "your time" line only
 * when the reader is not in Europe/London.
 *
 * Scheduled means a role section's start and end, or the event window
 * derived from them (RULE-18). It is never an actual check-in or check-out
 * stamp — those are viewer-local only — and never an audit stamp, which is
 * UK-only; both are different kinds in `displayTime` and neither comes
 * through here.
 */
export function ScheduledWindow({
  startsAt,
  endsAt,
  separator = ' – ',
  suffix = 'UK time',
  suffixWhen = 'dual',
  className,
  lineClass = 'sub',
  zone: override,
}: ScheduledWindowProps) {
  const browser = useViewerZone();
  const zone = override ?? browser;
  const start = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;
  const dual = needsDualZone(zone);
  const uk = `${formatTimeIn(start, UK_ZONE)}${separator}${formatTimeIn(end, UK_ZONE)}`;
  const labelled = suffix && (suffixWhen === 'always' || dual);
  return (
    <span className={className}>
      {uk}
      {labelled ? ` ${suffix}` : null}
      {dual ? (
        <span className={lineClass}>
          {formatTimeIn(start, zone)}
          {separator}
          {formatTimeIn(end, zone)} your time
        </span>
      ) : null}
    </span>
  );
}
