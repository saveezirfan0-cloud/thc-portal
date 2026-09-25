import type { EventStatus } from '@thc/domain';
import { type CalendarView, isCalendarView } from '../calendar';

/**
 * The /events filter state, as a URL — Scope §3.1.
 *
 * Every state of the Scheduling screen is a link: the view, the period and
 * the three filters all live in the query string, so a filtered diary can be
 * bookmarked, sent to a colleague, or reached with the back button. This is
 * the one place that turns search params into that state and back, so the
 * page, the toolbar and the saved views cannot disagree about a parameter's
 * name.
 *
 * Pure, and free of `next/*`, so it is unit-tested directly.
 */

export const EVENT_STATUSES: readonly EventStatus[] = [
  'upcoming',
  'ongoing',
  'completed',
  'cancelled',
] as const;

export interface EventQuery {
  view: CalendarView;
  /** The period's anchor, `YYYY-MM-DD` (UK calendar date). */
  date: string;
  q: string;
  clientId: string;
  /** An `EventStatus`, or '' for any. */
  status: string;
}

export type SearchParamsLike = Record<string, string | string[] | undefined>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date, not merely the right shape: `2026-02-30` is out. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isEventStatus(value: string): value is EventStatus {
  return (EVENT_STATUSES as readonly string[]).includes(value);
}

function single(params: SearchParamsLike, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Search params → the screen's state. Anything unrecognised falls back to
 * the default rather than failing: an old bookmark with a stale status or a
 * mistyped date still opens the diary, at today, in List.
 */
export function parseEventQuery(params: SearchParamsLike, today: string): EventQuery {
  const view = single(params, 'view');
  const date = single(params, 'date');
  const status = single(params, 'status');
  return {
    view: isCalendarView(view) ? view : 'list',
    date: isIsoDate(date) ? date : today,
    q: single(params, 'q').trim(),
    clientId: single(params, 'client').trim(),
    status: isEventStatus(status) ? status : '',
  };
}

/**
 * The screen's state → its URL. `view` and `date` are always written, so a
 * shared link opens on the same period whatever day it is opened; empty
 * filters are left out.
 */
export function eventsHref(query: Partial<EventQuery> & { view: CalendarView; date: string }) {
  const params = new URLSearchParams({ view: query.view, date: query.date });
  if (query.q) params.set('q', query.q);
  if (query.clientId) params.set('client', query.clientId);
  if (query.status) params.set('status', query.status);
  return `/events?${params.toString()}`;
}

// ---------------------------------------------------------------------
// The part of the state a saved view keeps
// ---------------------------------------------------------------------

/**
 * What a saved view remembers: the three filters and the view (List,
 * Month, Week, Day). Not the date — "Client A, cancelled, in Week" is a
 * view a manager returns to week after week, and one frozen on the week it
 * was saved would open on the past every time. Applying a view keeps the
 * period currently on screen.
 */
export interface EventFilterSet {
  view: CalendarView;
  q: string;
  clientId: string;
  status: string;
}

export function filterSetOf(query: EventQuery): EventFilterSet {
  return { view: query.view, q: query.q, clientId: query.clientId, status: query.status };
}

/** The current period, seen through a saved view. */
export function applyFilterSet(query: EventQuery, set: EventFilterSet): EventQuery {
  return { ...query, view: set.view, q: set.q, clientId: set.clientId, status: set.status };
}

export function sameFilterSet(a: EventFilterSet, b: EventFilterSet): boolean {
  return (
    a.view === b.view &&
    a.q.trim().toLowerCase() === b.q.trim().toLowerCase() &&
    a.clientId === b.clientId &&
    a.status === b.status
  );
}
