'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, viewerZone } from '@thc/domain';

/**
 * The zone the worker's phone is in (§1.8).
 *
 * A worker can be abroad between shifts, so a scheduled time must never
 * render as a single unlabelled clock they could take for their own. The
 * browser is the only thing that knows the zone, so the first paint is
 * UK-only and the "your time" line appears once mounted — the server's zone
 * is the one reading nobody wants.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}
