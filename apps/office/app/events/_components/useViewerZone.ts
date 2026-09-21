'use client';

import { useEffect, useState } from 'react';
import { UK_ZONE, viewerZone } from '@thc/domain';

/**
 * The zone the person reading this screen is actually in (§1.8).
 *
 * The office can be staffed from outside the UK, so a scheduled time must
 * never render as a single unlabelled clock. `viewerZone()` reads the
 * browser, which the server cannot know, so the first paint is UK-only and
 * the "your time" line appears once mounted. That keeps the markup identical
 * on both sides — a zone guessed during SSR would be the SERVER's, which is
 * the one reading nobody wants.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState(UK_ZONE);
  useEffect(() => setZone(viewerZone()), []);
  return zone;
}
