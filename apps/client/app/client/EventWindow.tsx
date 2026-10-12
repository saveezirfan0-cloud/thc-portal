'use client';

import { useViewerZone } from '@thc/ui';
import { UK_ZONE, formatDateIn, formatTimeIn, needsDualZone } from '@thc/domain';
import { dayMarker, daysLaterIn, differentDayFromUk } from './format';

/**
 * A scheduled window in dual zone (§1.8).
 *
 * "UK time" is the line every viewer gets; "your time" is added only when
 * the viewer's browser zone is not Europe/London. Never a single unlabelled
 * clock — a customer in Berlin reading "07:00" with no label is the exact
 * mistake §1.8 exists to prevent.
 *
 * The portal's two conventions: the "UK time" suffix is ALWAYS written (the
 * wireframe's "11:00 – 16:00 UK time" even for a reader in London), and the
 * second line is a `.sub`.
 *
 * Each line carries its own overnight marker (ADR-0050): " (+1 day)" when
 * the end falls on a later calendar day than the start IN THAT LINE'S ZONE.
 * 07:00 – 23:30 in London needs none; the same window read in Dubai is
 * 10:00 – 02:30 and does. That marker is why this no longer delegates to
 * `ScheduledWindow` (packages/ui), which has no place for one on its "your
 * time" line — but it keeps that component's hydration approach exactly:
 * the zone comes from `useViewerZone`, which is Europe/London on the server
 * and on the first client render and the browser's own zone only once
 * mounted. So the first paint is the UK line alone (its marker is computed
 * in Europe/London, the same on both sides), and the second line appears
 * after hydration.
 *
 * The UK line sits under (or beside) a UK date — the list's Date cell, the
 * event page's Date field — so it carries no date of its own. The "your
 * time" line does when the viewer's start falls on a different calendar
 * day from the UK start: 01:30 UK on Sat 19 Sep is 20:30 on Fri 18 Sep in
 * New York, and "20:30 – 06:30 your time" under "Sat 19 Sep" would send
 * the reader a day late. So that line reads "Fri 18 Sep 20:30 – 06:30
 * your time" (`yourTimeLine`).
 *
 * These are scheduled times, so they are dual. Actual check-in and check-out
 * stamps are viewer-local only and audit stamps are UK-only (§1.8) — neither
 * appears in this portal, which is why this component only handles the one
 * kind.
 */
export function EventWindow({
  startsAt,
  endsAt,
  className,
  zone: override,
}: {
  startsAt: string;
  endsAt: string;
  className?: string;
  /** The reader's zone, for tests and previews; otherwise the browser's. */
  zone?: string;
}) {
  const browser = useViewerZone();
  const zone = override ?? browser;
  const uk = windowLine(startsAt, endsAt, UK_ZONE, 'UK time');
  return (
    <span className={className}>
      {uk}
      {needsDualZone(zone) ? (
        <span className="sub">{yourTimeLine(startsAt, endsAt, zone)}</span>
      ) : null}
    </span>
  );
}

/**
 * The viewer's line: "02:30 – 06:30 your time", prefixed with the viewer's
 * own date ("Sat 19 Sep 02:30 – 06:30 your time") when their start day is
 * not the UK start day the date beside it names.
 */
export function yourTimeLine(startsAt: string, endsAt: string, zone: string): string {
  const line = windowLine(startsAt, endsAt, zone, 'your time');
  if (!differentDayFromUk(startsAt, zone)) return line;
  return `${formatDateIn(new Date(startsAt), zone, { weekday: 'short' })} ${line}`;
}

/** "17:00 – 01:30 UK time (+1 day)": one line, judged in its own zone. */
function windowLine(startsAt: string, endsAt: string, zone: string, label: string): string {
  const start = formatTimeIn(new Date(startsAt), zone);
  const end = formatTimeIn(new Date(endsAt), zone);
  return `${start} – ${end} ${label}${dayMarker(daysLaterIn(startsAt, endsAt, zone))}`;
}
