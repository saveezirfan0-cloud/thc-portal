'use client';

import { useViewerZone } from '@thc/ui';
import { needsDualZone } from '@thc/domain';
import { utcOffsetLabel } from '../client/format';

/**
 * "Viewer: Europe/Berlin (UTC+2)" in the portal's top bar
 * (wireframes/client/events.html): which zone the "your time" lines are in.
 *
 * Nothing for a reader on UK time — there is no second line to explain.
 * The browser's zone is only known once mounted (`useViewerZone` is UK on
 * the server and on the first client render), so this appears after
 * hydration, as the "your time" lines do, and the offset it prints is the
 * one in force at that moment.
 */
export function ViewerZoneNote({ zone: override }: { zone?: string }) {
  const browser = useViewerZone();
  const zone = override ?? browser;
  if (!needsDualZone(zone)) return null;
  return (
    <span className="tz">
      Viewer: {zone} ({utcOffsetLabel(zone, new Date())})
    </span>
  );
}
