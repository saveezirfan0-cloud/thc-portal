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
  const full = viewerZoneLabel(zone, new Date());
  const offset = utcOffsetLabel(zone, new Date());
  // Two spellings, one shown (client-portal.css): the full one on a wide
  // bar, "Your time: UTC−4" where the bar is short of room (761–1279px), so
  // it stays one line beside the company rather than wrapping to three.
  return (
    <span className="tz" title={full}>
      <span className="tz-full">{full}</span>
      <span className="tz-short">Your time: {offset}</span>
    </span>
  );
}

/**
 * "Viewer: Europe/Berlin (UTC+2)" — or just "Viewer: UTC" when the zone's
 * name IS its offset label, rather than the "UTC (UTC)" the walk found.
 */
export function viewerZoneLabel(zone: string, at: Date): string {
  const offset = utcOffsetLabel(zone, at);
  return zone === offset ? `Viewer: ${zone}` : `Viewer: ${zone} (${offset})`;
}
