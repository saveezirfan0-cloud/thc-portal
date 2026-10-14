'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@thc/ui';

/**
 * The amber note the download route sends a customer back with
 * (`?doc=missing` / `?doc=unavailable`, document/route.ts), shown once.
 *
 * The parameter used to stay in the address, so every reload — and the
 * page's own once-a-minute refresh — repeated "couldn't be downloaded" long
 * after it was true. Once the note is on screen the parameter is taken out
 * of the address with `history.replaceState` (no navigation, no re-read),
 * and the note itself is held here, so the next refresh of the page — which
 * no longer carries the parameter — does not snatch it away mid-sentence.
 * A reload, or coming back later, shows the page without it.
 *
 * Always rendered by the page, with or without a message, so it keeps its
 * place (and its state) across refreshes.
 */
export function DocNotice({ message }: { message: string | null }) {
  const [shown, setShown] = useState(message);

  useEffect(() => {
    if (message) setShown(message);
  }, [message]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('doc')) return;
    url.searchParams.delete('doc');
    const query = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${query ? `?${query}` : ''}${url.hash}`,
    );
  }, []);

  return shown ? <Alert tone="amber">{shown}</Alert> : null;
}
