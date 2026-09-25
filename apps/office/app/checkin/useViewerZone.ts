'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, viewerZone } from '@thc/domain';

/**
 * The zone the person reading the monitor is actually in (§1.8).
 *
 * Mount-guarded on purpose. `viewerZone()` reads `Intl`, and during the
 * server render of this client component that is the SERVER's zone (UTC on
 * Vercel) — so a bare call streamed a UTC "your time" line and UTC check-in
 * stamps to a UK manager, and React re-rendered on the hydration mismatch
 * with a flash of wrong times. First paint is UK on both sides; the
 * reader's zone arrives once mounted.
 *
 * A local copy of the hook /dashboard, /events and /reports carry: a
 * screen's own files are its own, and the shared home for one is
 * `packages/ui` (docs/10 §3). Noted for whoever lifts it.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}
