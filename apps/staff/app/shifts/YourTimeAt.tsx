'use client';

import { useViewerZone } from '../_components/useViewerZone';
import { yourTimeAt } from './offers';

/**
 * §1.8's "your time" line for ONE scheduled instant — an offer's close, the
 * end of the check-out window — under a first line that is UK time and
 * says so. What `ShiftTime` does for a window, for a moment: nothing on UK
 * time (and on the server's first paint), the viewer's own clock once the
 * browser has said where it is (`useViewerZone`).
 */
export function YourTimeAt({
  at,
  withDate = true,
  lead = '',
  className = 'xs muted mono',
}: {
  at: Date;
  /** "Sat 20, 17:00 your time" rather than "17:00 your time". */
  withDate?: boolean;
  /** Words in front, e.g. "Open until ". */
  lead?: string;
  className?: string;
}) {
  const zone = useViewerZone();
  const line = yourTimeAt(at, zone, withDate);
  if (!line) return null;
  return (
    <span className={`your-time ${className}`.trim()} style={{ display: 'block' }}>
      {lead}
      {line}
    </span>
  );
}
