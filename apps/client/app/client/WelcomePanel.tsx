'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@thc/ui';
import { WELCOME } from './rules';

/** Where this device remembers that the welcome was dismissed. */
export const WELCOME_KEY = 'thc.client.welcome.dismissed';

/** Whether this device has dismissed the welcome. Storage can throw (Safari private mode). */
export function welcomeDismissed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the dismissal; a device that cannot store it simply asks again next visit. */
export function rememberDismissed(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(WELCOME_KEY, '1');
  } catch {
    /* private mode — dismissed for this visit only */
  }
}

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The first-visit welcome above the list (ADR-0134 N8): three short lines —
 * what the portal shows, when the timesheets arrive (round 2's wording,
 * `ALLOCATION_TIMING`), how feedback works — and "Got it".
 *
 * Remembered per device in localStorage, every access wrapped, so a browser
 * that refuses storage shows it again next time rather than breaking. Drawn
 * only after mounting: the server cannot know, and drawing it first would
 * flash it at every returning customer. Not a `.panel`, so it never becomes
 * the list's titled card.
 */
export function WelcomePanel() {
  const [shown, setShown] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!welcomeDismissed(storageOrNull())) setShown(true);
  }, []);

  if (!shown) return null;

  function dismiss() {
    rememberDismissed(storageOrNull());
    setShown(false);
    // The button is about to go: focus moves to the page, not to <body>.
    document.getElementById('main')?.focus();
  }

  return (
    <aside className="cp-welcome" aria-labelledby={titleId}>
      <div className="cp-welcome-b">
        <h2 id={titleId}>{WELCOME.title}</h2>
        <ul>
          {WELCOME.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <Button size="sm" onClick={dismiss} aria-label="Got it, hide this welcome">
        Got it
      </Button>
    </aside>
  );
}
