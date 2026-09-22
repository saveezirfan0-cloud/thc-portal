'use client';

import { displayTime, formatHours, sectionHours } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * One role window, rendered per §1.8 — "18:00 – 01:00 (UK)" with a second
 * line in the worker's own zone when it differs.
 *
 * Always the ROLE SECTION's own start and end, never the event's (RULE-18):
 * on an event whose kitchen starts at 07:00 and whose floor starts at 17:00,
 * a worker sees only their own hours, and their check-in, check-out and
 * reminder windows run off these.
 */
export function ShiftTime({
  startsAt,
  endsAt,
  withDate = false,
  withHours = false,
}: {
  startsAt: Date;
  endsAt: Date;
  withDate?: boolean;
  withHours?: boolean;
}) {
  const zone = useViewerZone();
  const from = displayTime(startsAt, 'scheduled', zone, withDate);
  const to = displayTime(endsAt, 'scheduled', zone, withDate);
  return (
    <span className="shift-time">
      <span className="mono">
        {from.primary} – {to.primary}
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
