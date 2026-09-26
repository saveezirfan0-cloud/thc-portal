import { UK_ZONE, formatDateIn, formatTimeIn, ukInstant } from '@thc/domain';
import type { ViolationType } from './types';

/**
 * The pure rules behind /checkin's reads and its violation log (§9.5,
 * §1.8). No React, no Supabase: the page, the loader and the tests all
 * hold the same functions.
 */

/**
 * "Today" for the monitor, in UK terms (§9.5 "the live state of today's
 * events", §1.8 "every rule is evaluated in UK time").
 *
 * The board shows every role section that OVERLAPS the UK day
 * [00:00, 24:00): today's shifts, and a shift that started last night and
 * is still running past midnight — the one a manager still has to see
 * checked out. Tomorrow morning's shifts are not today's (audit), and
 * neither is yesterday's lunch.
 */
export function ukDayBounds(now: Date = new Date()): { from: string; to: string } {
  const today = ukDate(now);
  return {
    from: ukInstant(today, '00:00').toISOString(),
    to: ukInstant(addDays(today, 1), '00:00').toISOString(),
  };
}

/** `YYYY-MM-DD` of an instant in Europe/London. */
export function ukDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// The violation log: a server-side filter and pages (audit D50)
// ---------------------------------------------------------------------

/** Entries per page of the §9.5 violation log. */
export const VIOLATION_PAGE_SIZE = 50;

export interface LogQuery {
  /** §9.5 "Show resolved", unchecked by default. */
  showResolved: boolean;
  /** 1-based. */
  page: number;
}

/** `?resolved=1&page=2` → the log's query. Anything unreadable is the default. */
export function parseLogQuery(params: Record<string, string | string[] | undefined>): LogQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Number.parseInt(first(params['page']) ?? '', 10);
  return {
    showResolved: first(params['resolved']) === '1',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The href for a log query; the default is the bare route. */
export function logQueryHref(query: LogQuery): string {
  const search = new URLSearchParams();
  if (query.showResolved) search.set('resolved', '1');
  if (query.page > 1) search.set('page', String(query.page));
  const qs = search.toString();
  return qs ? `/checkin?${qs}` : '/checkin';
}

/** The `range()` a page reads: one row more than it shows, to know if there is a next. */
export function pageRange(page: number, size = VIOLATION_PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * size;
  return { from, to: from + size };
}

/**
 * The Time column (§9.5, checkin.html): the viewer's own clock, like every
 * actual instant on this screen (§1.8), with the day it happened — "today
 * 16:12", "Wed 17 · 22:48"; the month once it is another month, and the
 * year once it is another year.
 */
export function logTime(iso: string, zone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = formatTimeIn(at, zone);
  const day = formatDateIn(at, zone, { year: true });
  const today = formatDateIn(now, zone, { year: true });
  if (day === today) return `today ${time}`;
  const [, month, year] = day.split(' ');
  const [, thisMonth, thisYear] = today.split(' ');
  const label =
    year !== thisYear
      ? formatDateIn(at, zone, { weekday: 'short', year: true })
      : month !== thisMonth
        ? formatDateIn(at, zone, { weekday: 'short' })
        : formatDateIn(at, zone, { weekday: 'short' }).split(' ').slice(0, 2).join(' ');
  return `${label} · ${time}`;
}

/**
 * The detail window's "Flagged as" line (§9.5): the violation name plus the
 * event name, as the server composes it — "Checked out early — Gala
 * Dinner". The scope records that the wording can differ from the window's
 * title for the same violation ("Checked out early" against "Left early")
 * and keeps it as-is for v1.
 */
export const FLAGGED_AS_LABEL: Record<ViolationType, string> = {
  no_show: 'No-show',
  late: 'Late',
  left_early: 'Checked out early',
  left_geofence: 'Left the geofence',
  no_checkout: 'No check-out',
};

export function flaggedAs(type: ViolationType, eventTitle: string): string {
  return eventTitle ? `${FLAGGED_AS_LABEL[type]} — ${eventTitle}` : FLAGGED_AS_LABEL[type];
}
