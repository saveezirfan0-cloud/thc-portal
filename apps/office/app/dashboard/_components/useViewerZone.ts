'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, viewerZone } from '@thc/domain';

/**
 * The zone the person reading this screen is actually in (§1.8).
 *
 * `viewerZone()` reads the browser, which the server cannot know, so the
 * first paint is UK-only and the "your time" line appears once mounted.
 * That keeps the markup identical on both sides — a zone guessed during
 * SSR would be the SERVER's, which is the one reading nobody wants.
 *
 * A local copy of the hook `/events` carries. The two are deliberately not
 * shared through a cross-screen import: `_components` is a screen's own,
 * and the place for a shared one is `packages/ui`, which is the
 * design-system bot's (docs/10 §3). Noted for whoever lifts it.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}
