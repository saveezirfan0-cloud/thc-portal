'use client';

import { UK_ZONE, needsDualZone } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * The topbar's zone note (§1.8).
 *
 * The office can be staffed from outside the UK, so this states the
 * reader's own zone rather than asserting Europe/London. The windows in
 * the table below carry both zones; this says which the second line is.
 */
export function ViewerZone() {
  const zone = useViewerZone();
  return (
    <span>
      {needsDualZone(zone)
        ? `Viewer: ${zone} · event times in UK (${UK_ZONE})`
        : `Viewer: ${UK_ZONE} (UK)`}
    </span>
  );
}
