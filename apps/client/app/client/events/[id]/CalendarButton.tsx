'use client';

import { Button } from '@thc/ui';
import { buildIcs, icsFileName, lineupUrlFor } from '../../ics';
import type { PortalEvent } from '../../rules';

/**
 * "Add to calendar" in the event page's header (ADR-0050).
 *
 * Builds the .ics in the browser from the event the page already holds —
 * no request, no new view, nothing the client role could not already read.
 * The file carries the event's name, venue, scheduled window and PO number
 * and a link back to this page; never a worker's name, never money (§11.1).
 *
 * Not offered for a cancelled event: there is nothing left to attend.
 */
export function CalendarButton({ event }: { event: PortalEvent }) {
  if (event.status === 'cancelled') return null;

  function download() {
    const text = buildIcs(event, {
      lineupUrl: lineupUrlFor(window.location.origin, event.id),
      stampedAt: new Date(),
    });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFileName(event.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // After the click has been handled: revoking at once can cancel the
    // download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button onClick={download} title="Download a calendar file for this event">
      Add to calendar
    </Button>
  );
}
