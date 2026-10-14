'use client';

import { useEffect } from 'react';
import { Button } from '@thc/ui';

/**
 * "Print line-up" (ADR-0134 N6): the browser's own print, for the door host
 * before the Allocation Timesheet PDF is issued. What prints is decided by
 * the `@media print` rules in client-portal.css — the event's header, the
 * role windows and dress codes, every face and name by role; no buttons,
 * no top bar, no banners.
 *
 * Paper is light. While the page prints — from this button or from the
 * browser's own Print — the light appearance is put on <html> and the
 * reader's own is put back afterwards, so a dark-mode reader does not print
 * navy cards; the colours still come only from the tokens (ADR-0007). The
 * switch is never written to storage: the reader chose nothing.
 */
export function PrintButton() {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (previous !== null) root.setAttribute('data-theme', previous);
      previous = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, []);

  return (
    <Button tone="ghost" className="print-lineup" onClick={() => window.print()}>
      Print line-up
    </Button>
  );
}
