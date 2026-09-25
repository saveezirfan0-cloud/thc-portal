'use client';

import { UK_ZONE, needsDualZone } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * The topbar's zone note on the monitor (§1.8, checkin.html "Viewer:
 * Europe/Athens (UK +2h)").
 *
 * The check-in stamps, the Breaks times, the Due pill and the violation
 * log's Time column on this screen are all in the reader's own zone, so
 * the topbar has to say which zone that is rather than asserting "All
 * times UK" above them — the default the shell shows for screens with no
 * times at all.
 */
export function ViewerZone() {
  const zone = useViewerZone();
  return (
    <span>
      {needsDualZone(zone)
        ? `Viewer: ${zone} · scheduled times in UK (${UK_ZONE})`
        : `Viewer: ${UK_ZONE} (UK)`}
    </span>
  );
}
