'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` every `everyMs` while the tab is visible, and once more the
 * moment the tab comes back into view (unless it just ran). A hidden tab
 * costs nothing. The caller owns what "refresh" means — in the apps it is
 * `router.refresh()`, which re-runs the page's server reads and swaps the new
 * data in underneath, so filters, search text and open dialogs stay put.
 *
 * Polling rather than Realtime on purpose: the screens that use it are made
 * of views and RPCs over several tables, so a row event would only say
 * "something changed" and force the same re-read anyway.
 */
export function useVisibleInterval(refresh: () => void, everyMs = 30_000): void {
  // The callback (a router method) is not guaranteed stable across renders;
  // the timer is.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      latest.current();
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
