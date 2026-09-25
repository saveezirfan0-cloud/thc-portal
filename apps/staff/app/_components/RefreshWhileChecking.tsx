'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * While a share code is being checked with gov.uk (§2.6, ADR-0025), re-read
 * the page every 15 seconds so the outcome appears without the worker doing
 * anything — for up to ten minutes, after which pull-to-refresh (or the
 * notification) is the way. Renders nothing.
 */
const EVERY_MS = 15_000;
const FOR_MS = 10 * 60_000;

export function RefreshWhileChecking({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
