/**
 * What the list and the calendar actually render — Scope §3.1.
 *
 * Kept pure and apart from the components so the fill arithmetic, the status
 * and the ordering can be tested without a database or a browser. Every rule
 * it leans on comes from `@thc/domain`: the derived window (RULE-18), the
 * status (§1.5) and the fill (§3.2).
 */

import {
  type EventFill,
  type EventStatus,
  type RoleSectionWindow,
  UK_ZONE,
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatTimeIn,
  ukRoleWindow,
} from '@thc/domain';
import type { ListedEvent } from './data';
import { formatDayShort, ukDateOf } from './calendar';

export interface EventRow {
  id: string;
  title: string;
  date: string;
  clientName: string;
  venueName: string;
  venueAddress: string;
  geofenceRadiusM: number | null;
  poNumber: string;
  onsiteContact: string;
  /** When the event was cancelled, or null. The list prints its UK date. */
  cancelledAt: string | null;
  cancelReason: string;
  status: EventStatus;
  fill: EventFill;
  /** The derived window, or null while the event has no role sections. */
  window: RoleSectionWindow | null;
  /** "07:00 – 23:30" in UK time, or "—". */
  windowLabel: string;
  /** Set when the window runs past midnight, in Europe/London (§3.2). */
  endsNextDay: boolean;
  /** "ends Sat 20" — the list sub-line, named after the UK day (events.html). */
  endsLabel: string | null;
  roles: ListedEvent['roles'];
}

/** "cancelled by client 16 Sep — "event postponed to Q1"" (events.html). */
export function cancelledLine(row: Pick<EventRow, 'cancelledAt' | 'cancelReason'>): string | null {
  if (!row.cancelledAt) return null;
  const day = formatDayShort(ukDateOf(new Date(row.cancelledAt)));
  return row.cancelReason ? `cancelled ${day} — "${row.cancelReason}"` : `cancelled ${day}`;
}

/** Sort key: events within a day read in window order (§3.1 week view). */
function startedAt(row: EventRow): number {
  return row.window ? row.window.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
}

export function toEventRow(event: ListedEvent, now: Date = new Date()): EventRow {
  const sections = event.roles.map((role) => ukRoleWindow(event.date, role.start, role.end));
  const window = derivedEventWindow(sections);
  const endDate = window ? ukDateOf(window.endsAt) : null;

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    clientName: event.clientName,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    geofenceRadiusM: event.geofenceRadiusM,
    poNumber: event.poNumber,
    onsiteContact: event.onsiteContact,
    cancelledAt: event.cancelledAt,
    cancelReason: event.cancelReason,
    status: eventStatus(window, event.cancelledAt, now),
    fill: eventFill(event.roles),
    window,
    windowLabel: window
      ? `${formatTimeIn(window.startsAt, UK_ZONE)} – ${formatTimeIn(window.endsAt, UK_ZONE)}`
      : '—',
    // The window is stored as instants, so "past midnight" is a comparison
    // of LONDON civil dates against the event's own date (§1.8, §3.2). The
    // UTC date was wrong at both BST edges: a 23:30–00:30 window was not
    // flagged and a 00:30–08:00 one was.
    endsNextDay: endDate !== null && endDate > event.date,
    endsLabel: endDate !== null && endDate > event.date ? `ends ${formatDayShort(endDate)}` : null,
    roles: event.roles,
  };
}

export function toEventRows(events: ListedEvent[], now: Date = new Date()): EventRow[] {
  return events
    .map((event) => toEventRow(event, now))
    .sort((a, b) => (a.date === b.date ? startedAt(a) - startedAt(b) : a.date < b.date ? -1 : 1));
}

export interface DayBucket {
  iso: string;
  events: EventRow[];
  /** Events and open positions for the "N ev · M open" counter. */
  count: number;
  open: number;
  /** A day whose only events are cancelled reads "1 ev · cancelled". */
  allCancelled: boolean;
}

/** Groups rows by their own date, for the month and week cells (§3.1). */
export function bucketByDay(rows: EventRow[], days: string[]): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>(
    days.map((iso) => [iso, { iso, events: [], count: 0, open: 0, allCancelled: false }]),
  );

  for (const row of rows) {
    const bucket = buckets.get(row.date);
    if (!bucket) continue;
    bucket.events.push(row);
    bucket.count += 1;
    // A cancelled event is out of the staffing picture, so its unfilled
    // headcount is not something anyone still has to fill (§3.1).
    if (row.status !== 'cancelled') bucket.open += row.fill.open;
  }

  for (const bucket of buckets.values()) {
    bucket.allCancelled =
      bucket.count > 0 && bucket.events.every((event) => event.status === 'cancelled');
  }
  return buckets;
}

/** The totals under the list: "13 events in September · 45 open positions". */
export function periodTotals(rows: EventRow[]): { events: number; open: number } {
  return {
    events: rows.length,
    open: rows.reduce((sum, row) => (row.status === 'cancelled' ? sum : sum + row.fill.open), 0),
  };
}

/** The tone the chip and the fill pill carry (§3.1). */
export function fillTone(row: EventRow): 'green' | 'amber' | 'neutral' {
  if (row.status === 'cancelled') return 'neutral';
  return row.fill.open === 0 ? 'green' : 'amber';
}
