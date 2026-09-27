'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A thin bar across the top the instant a link is tapped.
 *
 * Every signed-in screen is rendered on the server per request (the app
 * lock is read from `staff_me()` each time), so between the tap and the
 * next screen — or its loading skeleton — there can be a moment where
 * nothing on the phone moves. Workers read that as "the tap didn't take"
 * and tap again. This answers the tap straight away; it clears when the
 * URL changes, and after a few seconds regardless, so a navigation that
 * lands back on the same URL (a redirect) never leaves it running.
 *
 * Listens in the capture phase: `next/link` calls `preventDefault()` on
 * its own clicks, so `defaultPrevented` says nothing about whether a
 * navigation is under way.
 */
const GIVE_UP_MS = 8_000;

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setBusy(false), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      if (link.getAttribute('aria-disabled') === 'true') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      setBusy(true);
    }
    // iOS Safari only applies `:active` (tap.css's pressed state) when a
    // touch listener exists somewhere up the tree.
    function noop() {}
    document.addEventListener('click', onClick, true);
    document.addEventListener('touchstart', noop, { passive: true });
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('touchstart', noop);
    };
  }, []);

  return <div className="nav-progress" data-busy={busy ? 'true' : undefined} aria-hidden="true" />;
}
