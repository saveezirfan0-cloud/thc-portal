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
  cancelledFinanceNote,
  derivedEventWindow,
  eventFill,
  eventStatus,
  formatTimeIn,
  needsDualZone,
  ukRoleWindow,
} from '@thc/domain';
import type { ListedEvent } from './data';

/**
 * A scheduled window as §1.8 displays it: UK time always, and a second
 * "your time" line only when the viewer is not in Europe/London. The same
 * helpers the dashboard and the check-in monitor use (`formatTimeIn`,
 * `needsDualZone`); this only fixes the separator the /events screens use.
 */
export function scheduledWindowLines(
  startsAt: Date,
  endsAt: Date,
  zone: string,
): { uk: string; local: string | null } {
  const uk = `${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)}`;
  if (!needsDualZone(zone)) return { uk, local: null };
  return { uk, local: `${formatTimeIn(startsAt, zone)} – ${formatTimeIn(endsAt, zone)} your time` };
}

/** A role on a list row, with its own window as instants for the zone line (§1.8). */
export type EventRowRole = ListedEvent['roles'][number] & { startsAt: string; endsAt: string };

export interface EventRow {
  id: string;
  title: string;
  date: string;
  clientId: string;
  clientName: string;
  venueName: string;
  venueAddress: string;
  poNumber: string;
  cancelReason: string;
  status: EventStatus;
  /**
   * A cancelled event's finance line (§3.3): before the day it is excluded
   * from financials; on the day (UK) the scheduled hours are billed and
   * paid. Null unless cancelled.
   */
  cancelledNote: string | null;
  fill: EventFill;
  /** The derived window, or null while the event has no role sections. */
  window: RoleSectionWindow | null;
  /** "07:00 – 23:30" in UK time, or "—". */
  windowLabel: string;
  /** The derived window as ISO instants, for the "your time" line; null without roles. */
  windowIso: { startsAt: string; endsAt: string } | null;
  /** Set when the window runs past midnight: "ends Sat 20". */
  endsNextDay: boolean;
  roles: EventRowRole[];
}

/** Sort key: events within a day read in window order (§3.1 week view). */
function startedAt(row: EventRow): number {
  return row.window ? row.window.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
}

export function toEventRow(event: ListedEvent, now: Date = new Date()): EventRow {
  const sections = event.roles.map((role) => ukRoleWindow(event.date, role.start, role.end));
  const window = derivedEventWindow(sections);

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    clientId: event.clientId,
    clientName: event.clientName,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    poNumber: event.poNumber,
    cancelReason: event.cancelReason,
    status: eventStatus(window, event.cancelledAt, now),
    cancelledNote: event.cancelledAt ? cancelledFinanceNote(event.cancelledAt, event.date) : null,
    fill: eventFill(event.roles),
    window,
    windowLabel: window
      ? `${formatTimeIn(window.startsAt, UK_ZONE)} – ${formatTimeIn(window.endsAt, UK_ZONE)}`
      : '—',
    windowIso: window
      ? { startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() }
      : null,
    // The window is stored as instants, so "past midnight" is a comparison
    // against the event's own date rather than a clock reading (§3.2).
    endsNextDay: window
      ? window.endsAt.toISOString().slice(0, 10) > utcDayOf(window.startsAt)
      : false,
    roles: event.roles.map((role, index) => ({
      ...role,
      startsAt: sections[index]!.startsAt.toISOString(),
      endsAt: sections[index]!.endsAt.toISOString(),
    })),
  };
}

function utcDayOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function toEventRows(events: ListedEvent[], now: Date = new Date()): EventRow[] {
  return events
    .map((event) => toEventRow(event, now))
    .sort((a, b) => (a.date === b.date ? startedAt(a) - startedAt(b) : a.date < b.date ? -1 : 1));
}

export interface EventFilters {
  /** `clients.id`, from the toolbar's Client select; '' for all. */
  clientId: string;
  status: string;
  q: string;
}

/**
 * The toolbar's filters (§3.1). Client matches on the id: two clients may
 * share a display name (a hotel group's properties often do), and a match
 * on the name showed both clients' events under either.
 */
export function filterEventRows(rows: EventRow[], filters: EventFilters): EventRow[] {
  const needle = filters.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (!needle) return true;
    return [row.title, row.clientName, row.venueName, row.poNumber]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
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
