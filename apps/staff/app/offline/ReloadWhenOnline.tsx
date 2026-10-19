'use client';

import { useEffect } from 'react';

/** Back online: wait up to this long at random, so a venue's phones do not all reload at once. */
export const ONLINE_RELOAD_SPREAD_MS = 3_000;

/**
 * The offline shell, and only it, reloads itself when the signal returns.
 *
 * `reloadOnOnline` (Serwist) used to do this for EVERY page, which on venue
 * signal reloaded the shift screen mid-check-in and threw away the
 * off-site check-out confirmation (go-live audit H5) — it is off now. This
 * page is different: it stands in for the page the worker asked for, holds
 * nothing, and the reload is what fetches the real one.
 */
export function ReloadWhenOnline({
  reload = () => window.location.reload(),
  random = Math.random,
}: {
  reload?: () => void;
  random?: () => number;
}) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onOnline = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, Math.round(random() * ONLINE_RELOAD_SPREAD_MS));
    };
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [reload, random]);
  return null;
}
