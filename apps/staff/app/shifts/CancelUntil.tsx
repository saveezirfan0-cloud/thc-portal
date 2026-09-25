'use client';

import { useViewerZone } from '../_components/useViewerZone';
import { cancelUntilLine } from './list';

/**
 * "Cancel available until Sat 20, 16:00 (72 h before start)" — RULE-04,
 * with the "your time" second line only for a worker outside the UK (§1.8).
 */
export function CancelUntil({ startsAt }: { startsAt: Date }) {
  const zone = useViewerZone();
  const line = cancelUntilLine(startsAt, zone);
  return (
    <span className="xs muted cancel-until">
      <span>{line.primary}</span>
      {line.secondary ? <span className="sub">{line.secondary}</span> : null}
    </span>
  );
}
