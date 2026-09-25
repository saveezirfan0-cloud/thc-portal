'use client';

import {
  UK_ZONE,
  formatDateIn,
  formatHours,
  formatTimeIn,
  needsDualZone,
  sectionHours,
  ukToday,
} from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * One role window, rendered per §1.8 — "18:00 – 01:00 (UK)" with a second
 * line in the worker's own zone when it differs.
 *
 * Always the ROLE SECTION's own start and end, never the event's (RULE-18):
 * on an event whose kitchen starts at 07:00 and whose floor starts at 17:00,
 * a worker sees only their own hours, and their check-in, check-out and
 * reminder windows run off these.
 *
 * With a date, the wireframes (staff/shifts.html) put ONE prefix in front
 * of the window — "Tomorrow · 18:00 – 01:00", "Sat 20 · 11:00 – 00:30" —
 * never a date on each end. The prefix is the UK calendar day the shift
 * starts on, relative to the UK's today, because the scheduled line is UK
 * time. The "your time" line underneath is `yourTimeLine()`: the viewer's
 * window, said once, with a date only where the viewer's day differs.
 */
export function ShiftTime({
  startsAt,
  endsAt,
  withDate = false,
  withHours = false,
  withMonth = false,
  now,
}: {
  startsAt: Date;
  endsAt: Date;
  withDate?: boolean;
  withHours?: boolean;
  /** "Sat 20 Sep" rather than "Sat 20", for dates further out than a week. */
  withMonth?: boolean;
  /** "Today" / "Tomorrow" are relative to this instant (default: now). */
  now?: Date;
}) {
  const zone = useViewerZone();
  // One "(UK)" for the window, not one per end (§1.8).
  const window = `${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)}${needsDualZone(zone) ? ' (UK)' : ''}`;
  const primary = withDate ? `${dayPrefix(startsAt, now, withMonth)} · ${window}` : window;
  const secondary = yourTimeLine(startsAt, endsAt, zone);
  return (
    <span className="shift-time">
      <span className="mono">
        {primary}
        {withHours ? ` · ${formatHours(sectionHours({ startsAt, endsAt }))}` : null}
      </span>
      {secondary ? <span className="sub mono">{secondary}</span> : null}
    </span>
  );
}

/**
 * The §1.8 second line for a scheduled window: "15:00 – 20:00 your time".
 *
 * Null where the viewer is on UK time — there is no second line to draw.
 * Otherwise the viewer's own clock, once, with "your time" once. A date
 * leads it ("Sat 12 · 02:00 – 07:00 your time") only when the day the
 * shift STARTS on in the viewer's zone is not the UK day the first line
 * names; an end past midnight reads the way the UK line already does
 * ("18:00 – 01:00"), without a second date.
 */
export function yourTimeLine(startsAt: Date, endsAt: Date, zone: string): string | null {
  if (!needsDualZone(zone)) return null;
  const window = `${formatTimeIn(startsAt, zone)} – ${formatTimeIn(endsAt, zone)} your time`;
  const ukDay = ukToday(startsAt);
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startsAt);
  return localDay === ukDay ? window : `${weekdayAndDay(startsAt, zone)} · ${window}`;
}

/**
 * "Today", "Tomorrow", else the UK weekday and day-of-month: "Sat 20" —
 * or "Sat 20 Sep" with `withMonth`, for a date far enough out that the
 * day-of-month alone could be either month.
 */
export function dayPrefix(startsAt: Date, now: Date = new Date(), withMonth = false): string {
  const day = ukToday(startsAt);
  if (day === ukToday(now)) return 'Today';
  if (day === ukToday(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return 'Tomorrow';
  return withMonth
    ? formatDateIn(startsAt, UK_ZONE, { weekday: 'short' })
    : weekdayAndDay(startsAt, UK_ZONE);
}

/**
 * "Sat 20" in `zone`. formatDateIn, not Intl's format(): engines differ on
 * the comma ("Sat, 20" / "Sat 20"), and a client component rendered on the
 * server must print the same string in the browser.
 */
function weekdayAndDay(instant: Date, zone: string): string {
  return formatDateIn(instant, zone, { weekday: 'short' }).split(' ').slice(0, 2).join(' ');
}
