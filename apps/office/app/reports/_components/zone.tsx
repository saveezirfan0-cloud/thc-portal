'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, formatTimeIn, needsDualZone, viewerZone } from '@thc/domain';

/**
 * §1.8 on the Payroll tab, which shows both kinds of time side by side:
 *
 *   · scheduled windows — UK, plus a "your time" line when the reader is
 *     elsewhere;
 *   · actual check-in/out stamps — the reader's own clock only.
 *
 * Local copies of the hook /dashboard and /events carry, for the reason
 * their comments give: a screen's `_components` are its own, and the shared
 * home for one is `packages/ui`. First paint is UK so the server and the
 * browser render identical markup; the reader's zone arrives once mounted.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}

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

export function ScheduledWindow({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const zone = useViewerZone();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const uk = `${formatTimeIn(start, UK_ZONE)} – ${formatTimeIn(end, UK_ZONE)}`;
  if (!needsDualZone(zone)) return <span className="mono">{uk}</span>;
  return (
    <span className="mono">
      {uk} (UK)
      <span className="sub">
        {formatTimeIn(start, zone)} – {formatTimeIn(end, zone)} your time
      </span>
    </span>
  );
}

/** An actual stamp: the reader's own clock, never dual (§1.8). */
export function ActualTime({ at, className }: { at: string | null; className?: string }) {
  const zone = useViewerZone();
  if (!at) return <span className={className}>—</span>;
  return <span className={className}>{formatTimeIn(new Date(at), zone)}</span>;
}
