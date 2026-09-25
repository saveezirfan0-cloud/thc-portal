'use client';

import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { useViewerZone } from './useViewerZone';

/**
 * A scheduled window, per §1.8: UK time, plus a second "your time" line
 * when the reader is not in Europe/London.
 *
 * Every window on this screen is a SCHEDULED one — a role section's start
 * and end, or the event window derived from them — so it never takes the
 * `actual` or `audit` branch. Those are check-in stamps and signatures, and
 * neither appears on §9.1.
 */
export function ScheduledWindow({
  startsAt,
  endsAt,
  className,
}: {
  startsAt: string;
  endsAt: string;
  className?: string;
}) {
  const zone = useViewerZone();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const uk = `${formatTimeIn(start, UK_ZONE)}–${formatTimeIn(end, UK_ZONE)}`;

  if (!needsDualZone(zone)) {
    return <span className={className}>{uk}</span>;
  }

  return (
    <span className={className}>
      {/* §1.8's own label: "06:15 – 23:00 UK time", never a bare "(UK)". */}
      {uk} UK time
      <span className="sub">
        {formatTimeIn(start, zone)}–{formatTimeIn(end, zone)} your time
      </span>
    </span>
  );
}
