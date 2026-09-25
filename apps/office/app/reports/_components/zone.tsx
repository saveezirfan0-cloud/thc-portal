'use client';

import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { ScheduledWindow as Shared, useViewerZone } from '@thc/ui';

export { useViewerZone };

/**
 * §1.8 on the Payroll tab, which shows both kinds of time side by side:
 *
 *   · scheduled windows — UK, plus a "your time" line when the reader is
 *     elsewhere;
 *   · actual check-in/out stamps — the reader's own clock only.
 *
 * The hook and the scheduled window are packages/ui's (`useViewerZone`,
 * `ScheduledWindow`), shared with /dashboard and /events. First paint is UK
 * so the server and the browser render identical markup; the reader's zone
 * arrives once mounted.
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

/** The payroll table's column is narrow, so the UK line is labelled "(UK)". */
export function ScheduledWindow({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  return <Shared startsAt={startsAt} endsAt={endsAt} suffix="(UK)" className="mono" />;
}

/** An actual stamp: the reader's own clock, never dual (§1.8). */
export function ActualTime({ at, className }: { at: string | null; className?: string }) {
  const zone = useViewerZone();
  if (!at) return <span className={className}>—</span>;
  return <span className={className}>{formatTimeIn(new Date(at), zone)}</span>;
}
