'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered screen current without a manual reload: re-runs
 * the page's server reads every `everyMs` while the tab is visible, and once
 * more the moment the tab comes back into view. `router.refresh()` swaps the
 * new data in underneath, so filters, search text and open dialogs stay put.
 *
 * Polling rather than Realtime on purpose: the screens that use it are made
 * of views and RPCs over several tables (and personal data the office
 * reads through owner-rights views), so a row event would only say "something
 * changed" and force the same re-read anyway.
 */
export function useAutoRefresh(everyMs = 30_000): void {
  const router = useRouter();
  // The router object is not guaranteed stable across renders; the timer is.
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;

  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      refresh.current();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= everyMs / 2) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [everyMs]);
}
