'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Drop into a server page (`<AutoRefresh />`) to re-read it now and then
 * while the worker has it open, so an invite, an offered shift or a release
 * made elsewhere appears without a manual reload. Renders nothing.
 *
 * Go-live audit H3: with ~1,000 phones this was the load floor — every
 * open /shifts, /invites and /radar re-ran the whole page every 60 s, all in
 * step after a push. So, for the Staff App (the shared `useVisibleInterval`
 * the Back Office uses is unchanged):
 *
 * - every ~150 s, each wait drawn ±20 s at random so phones drift apart;
 * - nothing while the page is hidden or the phone is offline (a refresh
 *   that cannot arrive is only a failed request);
 * - back in view, or back online, a refresh only if the page is more than
 *   30 s old — a page just navigated to (a push tap opens its target) is
 *   already fresh — and only after a short pause, so the navigation a push
 *   tap starts lands first instead of racing a refresh of the old page.
 *   Back online the pause is itself random, so a venue's phones
 *   regaining signal together do not all ask at once.
 */
export const REFRESH_EVERY_MS = 150_000;
export const REFRESH_JITTER_MS = 20_000;
/** Back in view or online: refresh only a page older than this. */
export const STALE_AFTER_MS = 30_000;
/** Back in view: wait this long, so a push tap's navigation goes first. */
export const RETURN_PAUSE_MS = 1_500;
/** Back online: wait up to this long, at random. */
export const ONLINE_SPREAD_MS = 10_000;

/** One wait: `base` ± `jitter`, never below a second. */
export function nextDelay(base: number, jitter: number, random: () => number = Math.random) {
  return Math.max(1_000, Math.round(base + (random() * 2 - 1) * jitter));
}

export function AutoRefresh({
  everyMs = REFRESH_EVERY_MS,
  jitterMs = REFRESH_JITTER_MS,
}: {
  everyMs?: number;
  jitterMs?: number;
}) {
  const router = useRouter();
  // The router method is not guaranteed stable across renders; the timer is.
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;

  useEffect(() => {
    // The render that mounted this is as fresh as a refresh would be.
    let last = Date.now();
    let tick: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const canRun = () =>
      document.visibilityState === 'visible' &&
      (typeof navigator === 'undefined' || navigator.onLine !== false);
    const run = () => {
      last = Date.now();
      refresh.current();
    };
    const schedule = () => {
      tick = setTimeout(
        () => {
          if (canRun()) run();
          schedule();
        },
        nextDelay(everyMs, jitterMs),
      );
    };
    const soon = (pauseMs: number) => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (canRun() && Date.now() - last >= STALE_AFTER_MS) run();
      }, pauseMs);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon(RETURN_PAUSE_MS);
      else clearTimeout(pending);
    };
    const onOnline = () => soon(RETURN_PAUSE_MS + Math.round(Math.random() * ONLINE_SPREAD_MS));

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(tick);
      clearTimeout(pending);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [everyMs, jitterMs]);

  return null;
}
