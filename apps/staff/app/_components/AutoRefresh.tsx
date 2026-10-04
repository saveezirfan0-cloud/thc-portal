'use client';

import { useRouter } from 'next/navigation';
import { useVisibleInterval } from '@thc/ui';

/**
 * Drop into a server page (`<AutoRefresh />`) to re-read it every `everyMs`
 * while the tab is visible and when it regains focus, so changes made
 * elsewhere (the office, another device) appear without a manual reload.
 * Renders nothing.
 */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useVisibleInterval(router.refresh, everyMs);
  return null;
}
