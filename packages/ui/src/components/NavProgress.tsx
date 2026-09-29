'use client';

import { useEffect, useState } from 'react';

/**
 * A thin bar across the top the instant a link is clicked, so the person
 * knows the click took and the next page is on its way.
 *
 * Every signed-in screen is rendered on the server per request, so between
 * the click and the next screen (or its loading skeleton) there can be a
 * moment where nothing moves. People read that as "it didn't take" and click
 * again. This answers the click straight away, marks the link that was
 * pressed (`data-pending`, styled as a spinner in components.css), and
 * clears when the route changes — and after a few seconds regardless, so a
 * navigation that lands back on the same URL (a redirect) never leaves it
 * running.
 *
 * `routeKey` is the current pathname + search. It is a prop rather than
 * read here because this package does not depend on `next`: each app's
 * `NavProgress` wrapper reads it from `next/navigation` (in a Suspense
 * boundary, as `useSearchParams` requires).
 *
 * Listens in the capture phase: `next/link` calls `preventDefault()` on its
 * own clicks, so `defaultPrevented` says nothing about whether a navigation
 * is under way.
 *
 * Code that navigates without a link — a table row, a filter that calls
 * `router.push` — calls `startNavProgress()` first.
 */
const GIVE_UP_MS = 8_000;
const START_EVENT = 'thc:nav-start';

/** Starts the bar for a navigation that did not come from a link click. */
export function startNavProgress(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT));
}

function clearPending(): void {
  for (const el of document.querySelectorAll('[data-pending="true"]')) {
    el.removeAttribute('data-pending');
  }
}

export function NavProgress({ routeKey }: { routeKey: string }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
    clearPending();
  }, [routeKey]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      clearPending();
    }, GIVE_UP_MS);
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
      clearPending();
      link.setAttribute('data-pending', 'true');
      setBusy(true);
    }
    // A GET form (a date range, a filter) navigates to its own URL with the
    // fields as the query. A server-action form does not navigate, so it
    // shows its own pending state on its submit button instead.
    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.getAttribute('method')?.toLowerCase() !== 'get') return;
      setBusy(true);
    }
    const start = () => setBusy(true);
    // iOS Safari only applies `:active` (the pressed state) when a touch
    // listener exists somewhere up the tree.
    function noop() {}
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener(START_EVENT, start);
    document.addEventListener('touchstart', noop, { passive: true });
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener(START_EVENT, start);
      document.removeEventListener('touchstart', noop);
    };
  }, []);

  return <div className="nav-progress" data-busy={busy ? 'true' : undefined} aria-hidden="true" />;
}
