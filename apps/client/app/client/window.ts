import { UK_ZONE, formatDateIn } from '@thc/domain';

/**
 * How much of the customer's history the event list reads (§11.1).
 *
 * Pure, no Supabase and no React, so the server page (which reads) and
 * `EventsScreen` (which decides when a filter change needs a fresh read)
 * apply the same rule and cannot disagree.
 *
 * Why there is a window at all: PostgREST stops every response at
 * `max_rows` (1000 — supabase/config.toml, and the hosted default) without
 * an error. Reading "everything the customer ever had" worked for a few
 * months and then started dropping faces, then role sections, then whole
 * events, silently. So the list reads:
 *
 *   · every event that has not ended yet (upcoming, ongoing, a future
 *     cancellation) — always in full, because the Upcoming tab and the
 *     "Next up" strip must never be partial;
 *   · past events that STARTED on or after `since` (a UK calendar day) and,
 *     when the "To" filter is set, on or before `until`.
 *
 * `since` defaults to `PAST_WINDOW_DAYS` before today. The "From" filter
 * replaces it (the filter hides anything earlier anyway, so the read is
 * exactly what can be shown); a "To" on its own pages the window back to
 * end there; `?since=` — what "Show older events" writes — only ever widens.
 * Days are UK calendar days, the day the list's Date column prints and the
 * date filters compare (`applyFilters`, §1.8).
 */
export const PAST_WINDOW_DAYS = 90;

/** The past events a list read covers: UK days, inclusive; `until` null = up to now. */
export interface PastWindow {
  since: string;
  until: string | null;
}

/** What the page read, as `EventsScreen` receives it. */
export interface LoadedHistory extends PastWindow {
  /** A past event exists before `since`: "Show older events" has something to show. */
  older: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-mm-dd`, and a real calendar day (no 2026-02-30). '' otherwise. */
export function validDay(value: string | null | undefined): string {
  if (!value || !DAY.test(value)) return '';
  const at = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value ? '' : value;
}

/** A calendar day `n` days after `day` (negative for before). */
export function addDays(day: string, n: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/**
 * The window a list address asks for, given today's UK date. Reads `from`,
 * `to` and `since`; everything else in the address (tab, search, venue) is
 * applied in the browser to rows already read and changes nothing here.
 */
export function pastWindow(
  params: { get(name: string): string | null },
  today: string,
): PastWindow {
  const from = validDay(params.get('from'));
  const to = validDay(params.get('to'));
  const asked = validDay(params.get('since'));
  const until = to || null;

  // "From" bounds the filter exactly: nothing before it can be shown.
  if (from) return { since: from, until };

  // Otherwise PAST_WINDOW_DAYS back from today — or from "To", when that is
  // earlier, so a "To" two years ago reads those days and not the two years
  // since. `?since=` may only widen it.
  const anchor = until && until < today ? until : today;
  const base = addDays(anchor, -PAST_WINDOW_DAYS);
  return { since: asked && asked < base ? asked : base, until };
}

/** Two windows read the same rows. */
export function sameWindow(a: PastWindow, b: PastWindow): boolean {
  return a.since === b.since && (a.until ?? null) === (b.until ?? null);
}

/**
 * The list query with `since` carried along. `listQuery` (rules.ts) writes
 * only the tab and the filters, so without this the first keystroke in the
 * search box would quietly drop the widened window from the address and the
 * next refresh would narrow it again.
 */
export function withSince(query: string, since: string | null | undefined): string {
  const day = validDay(since);
  if (!day) return query;
  const q = new URLSearchParams(query);
  q.set('since', day);
  return q.toString();
}

/**
 * "Show older events": the same view, `PAST_WINDOW_DAYS` further back.
 * `query` is the list's current query (tab and filters, `listQuery`).
 */
export function olderQuery(query: string, loaded: PastWindow): string {
  const q = new URLSearchParams(query);
  q.set('since', addDays(loaded.since, -PAST_WINDOW_DAYS));
  return q.toString();
}

/** "16 Jul 2026" for a UK calendar day: the "since" the list names. */
export function dayLabel(day: string): string {
  // Midday UTC is the same calendar day in London in summer and in winter.
  return formatDateIn(new Date(`${day}T12:00:00Z`), UK_ZONE, { year: true });
}
