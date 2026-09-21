'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, formatTimeIn, needsDualZone, viewerZone } from '@thc/domain';

/**
 * A scheduled window in dual zone (§1.8).
 *
 * "UK time" is the line every viewer gets; "your time" is added only when
 * the viewer's browser zone is not Europe/London. Never a single unlabelled
 * clock — a customer in Berlin reading "07:00" with no label is the exact
 * mistake §1.8 exists to prevent.
 *
 * The viewer's zone is a browser fact. Rendering it on the server would use
 * the server's zone — UTC on Vercel — and quietly produce a wrong second
 * line, so the UK line renders immediately and the "your time" line appears
 * once mounted. Server and client agree on the first paint, which is also
 * what keeps React from complaining about a hydration mismatch.
 *
 * These are scheduled times, so they are dual. Actual check-in and check-out
 * stamps are viewer-local only and audit stamps are UK-only (§1.8) — neither
 * appears in this portal, which is why this component only handles the one
 * kind.
 */
export function EventWindow({
  startsAt,
  endsAt,
  className,
}: {
  startsAt: string;
  endsAt: string;
  className?: string;
}) {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => setZone(viewerZone()), []);

  const from = new Date(startsAt);
  const to = new Date(endsAt);
  const uk = `${formatTimeIn(from, UK_ZONE)} – ${formatTimeIn(to, UK_ZONE)}`;
  const dual = zone !== null && needsDualZone(zone);

  return (
    <span className={className}>
      <span>{uk} UK time</span>
      {dual ? (
        <span className="sub">
          {formatTimeIn(from, zone)} – {formatTimeIn(to, zone)} your time
        </span>
      ) : null}
    </span>
  );
}
