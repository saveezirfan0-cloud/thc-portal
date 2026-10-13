'use client';

import { useViewerZone } from '@thc/ui';
import { UK_ZONE, formatDateIn, formatTimeIn, needsDualZone } from '@thc/domain';

/**
 * "as of Thu 18 Sep 2026, 15:32 your time (14:32 UK)" — when the page's
 * rows were read (wireframes/client/events.html, event.html).
 *
 * `now` is the server's read time, so the stamp moves when `AutoRefresh`
 * re-renders the page and says how fresh the counts are. It follows the
 * dual-zone rule of the windows it sits above (§1.8): the UK reading is the
 * first paint, on the server and in the browser alike, and a reader outside
 * UK time gets their own clock once mounted, with the UK one in brackets.
 */
export function AsOf({ now, zone: override }: { now: string; zone?: string }) {
  const browser = useViewerZone();
  const zone = override ?? browser;
  const at = new Date(now);
  const day = (z: string) => formatDateIn(at, z, { weekday: 'short', year: true });

  if (!needsDualZone(zone)) {
    return (
      <span className="asof">
        as of{' '}
        <b>
          {day(UK_ZONE)}, {formatTimeIn(at, UK_ZONE)} UK time
        </b>
      </span>
    );
  }
  return (
    <span className="asof">
      as of{' '}
      <b>
        {day(zone)}, {formatTimeIn(at, zone)} your time
      </b>{' '}
      ({formatTimeIn(at, UK_ZONE)} UK)
    </span>
  );
}
