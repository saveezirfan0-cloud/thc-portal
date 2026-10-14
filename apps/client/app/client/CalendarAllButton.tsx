'use client';

import { useMemo } from 'react';
import { Button } from '@thc/ui';
import { saveCalendarFile } from './download';
import { buildCalendar, icsFileName, lineupUrlFor, upcomingForCalendar } from './ics';
import type { PortalEvent } from './rules';

/**
 * "Add all upcoming to calendar" under the list (ADR-0134 N7): one .ics file
 * with every event that has not ended and is not cancelled, built in the
 * browser from the rows the list already holds. Each entry keeps ADR-0050's
 * UID, so importing it again — or after a single event's file — updates
 * the entries instead of adding a second copy. No worker names, no money.
 * Nothing is drawn when there is nothing ahead.
 */
export function CalendarAllButton({ events, now }: { events: PortalEvent[]; now: string }) {
  const ahead = useMemo(() => upcomingForCalendar(events, new Date(now)), [events, now]);
  if (ahead.length === 0) return null;

  function download() {
    const origin = window.location.origin;
    const text = buildCalendar(ahead, {
      lineupUrl: (id) => lineupUrlFor(origin, id),
      stampedAt: new Date(),
    });
    saveCalendarFile(text, icsFileName('THC upcoming events'));
  }

  return (
    <Button
      size="sm"
      tone="ghost"
      onClick={download}
      title={
        ahead.length === 1
          ? 'One calendar file with your upcoming event'
          : `One calendar file with all ${ahead.length} of your upcoming events`
      }
    >
      Add all upcoming to calendar
    </Button>
  );
}
