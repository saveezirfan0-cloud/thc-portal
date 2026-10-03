'use client';

import { useRouter } from 'next/navigation';
import { useVisibleInterval } from '@thc/ui';

/**
 * Keeps a server-rendered screen current without a manual reload: re-runs
 * the page's server reads every `everyMs` while the tab is visible and when
 * it regains focus. See `useVisibleInterval` in @thc/ui.
 */
export function useAutoRefresh(everyMs = 30_000): void {
  const router = useRouter();
  useVisibleInterval(router.refresh, everyMs);
}
