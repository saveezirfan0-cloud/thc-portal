'use client';

import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

/**
 * A document download (§11.3) that says it is working.
 *
 * The link goes to `/client/events/:id/document`, which reads the view, signs
 * a Storage URL and redirects to the PDF — a few seconds on a slow line with
 * nothing on screen to say the tap landed, so customers tapped again. After a
 * plain click the link reads "Preparing…" and is `aria-busy`; a second click
 * while it is preparing does nothing.
 *
 * It stays a real `<a href>`, so it can still be long-pressed, copied or
 * opened in a new tab (§11.4: forwarded from a phone); a click with a
 * modifier key or another button is the browser's own and changes nothing
 * here. The pending state ends when the page is shown again (`pageshow`,
 * which also fires when Back restores it from the back-forward cache), and
 * after `PENDING_MS` in any case — a PDF that downloads rather than opens
 * never leaves the page, so nothing else would end it.
 */
export const PENDING_MS = 8_000;

export function DocumentLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(false), PENDING_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (pending) {
      e.preventDefault();
      return;
    }
    setPending(true);
  }

  return (
    <a
      className={className}
      href={href}
      onClick={onClick}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
    >
      {pending ? (
        <>
          <span className="doc-spin" aria-hidden="true" />
          Preparing…
        </>
      ) : (
        children
      )}
    </a>
  );
}
