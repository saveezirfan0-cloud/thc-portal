'use client';

import { ScheduledWindow as Shared } from '@thc/ui';

/**
 * A scheduled window on §9.1, per §1.8: UK time, plus a second "your time"
 * line when the reader is not in Europe/London. The component is
 * `ScheduledWindow` in packages/ui; the dashboard's tables are dense, so
 * this is the same thing with the spaces dropped from the separator.
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
  return <Shared startsAt={startsAt} endsAt={endsAt} separator="–" className={className} />;
}
