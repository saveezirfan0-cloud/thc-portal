'use client';

import { ScheduledWindow } from '@thc/ui';

/**
 * A scheduled window in dual zone (§1.8).
 *
 * "UK time" is the line every viewer gets; "your time" is added only when
 * the viewer's browser zone is not Europe/London. Never a single unlabelled
 * clock — a customer in Berlin reading "07:00" with no label is the exact
 * mistake §1.8 exists to prevent.
 *
 * `ScheduledWindow` (packages/ui) does the work: the UK line renders on the
 * server, the viewer's zone is read once mounted, and the second line
 * appears then — so server and client agree on the first paint. This
 * wrapper only fixes the portal's two conventions: the "UK time" suffix is
 * ALWAYS written (`suffixWhen="always"`, the wireframe's "11:00 – 16:00 UK
 * time" even for a reader in London), and the second line is a `.sub`.
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
  zone,
}: {
  startsAt: string;
  endsAt: string;
  className?: string;
  /** The reader's zone, for tests and previews; otherwise the browser's. */
  zone?: string;
}) {
  return (
    <ScheduledWindow
      startsAt={startsAt}
      endsAt={endsAt}
      suffixWhen="always"
      lineClass="sub"
      className={className}
      zone={zone}
    />
  );
}
