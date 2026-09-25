'use client';

import {
  UK_ZONE,
  displayTime,
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
 * time; the "your time" line underneath keeps both dates, since an
 * overnight shift can change day in the viewer's zone.
 */
export function ShiftTime({
  startsAt,
  endsAt,
  withDate = false,
  withHours = false,
  now,
}: {
  startsAt: Date;
  endsAt: Date;
  withDate?: boolean;
  withHours?: boolean;
  /** "Today" / "Tomorrow" are relative to this instant (default: now). */
  now?: Date;
}) {
  const zone = useViewerZone();
  const from = displayTime(startsAt, 'scheduled', zone, withDate);
  const to = displayTime(endsAt, 'scheduled', zone, withDate);
  const primary = withDate
    ? `${dayPrefix(startsAt, now)} · ${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)}${needsDualZone(zone) ? ' (UK)' : ''}`
    : `${from.primary} – ${to.primary}`;
  return (
    <span className="shift-time">
      <span className="mono">
        {primary}
        {withHours ? ` · ${formatHours(sectionHours({ startsAt, endsAt }))}` : null}
      </span>
      {from.secondary ? (
        <span className="sub mono">
          {from.secondary} – {to.secondary}
        </span>
      ) : null}
    </span>
  );
}

/** "Today", "Tomorrow", else the UK weekday and day-of-month: "Sat 20". */
export function dayPrefix(startsAt: Date, now: Date = new Date()): string {
  const day = ukToday(startsAt);
  if (day === ukToday(now)) return 'Today';
  if (day === ukToday(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: UK_ZONE,
  }).format(startsAt);
}
