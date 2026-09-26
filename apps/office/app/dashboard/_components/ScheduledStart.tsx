'use client';

import { UK_ZONE, formatDateIn, formatTimeIn, needsDualZone } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * A scheduled START, with its day, per §1.8: "Fri 25 Sep · 18:00" in UK
 * time, plus a "your time" line when the reader is not in Europe/London.
 *
 * The short-staffed panel spans up to three calendar days, so a bare clock
 * would not say which day; and it lists starts, not windows, so the shared
 * `ScheduledWindow` does not fit. The day is formatted in each zone on its
 * own line, because 01:00 in London is still the previous evening in New
 * York.
 *
 * The first paint is UK-only (the server cannot know the reader's zone);
 * the second line appears once mounted, as `ScheduledWindow` does.
 */
export function ScheduledStart({
  startsAt,
  zone: override,
}: {
  startsAt: string;
  /** For previews and tests; otherwise the browser's. */
  zone?: string;
}) {
  const browser = useViewerZone();
  const zone = override ?? browser;
  const instant = new Date(startsAt);
  const label = (tz: string) =>
    `${formatDateIn(instant, tz, { weekday: 'short' })} · ${formatTimeIn(instant, tz)}`;
  const dual = needsDualZone(zone);

  return (
    <span className="mono">
      {label(UK_ZONE)}
      {dual ? (
        <>
          {' UK time'}
          <span className="sub">{label(zone)} your time</span>
        </>
      ) : null}
    </span>
  );
}
