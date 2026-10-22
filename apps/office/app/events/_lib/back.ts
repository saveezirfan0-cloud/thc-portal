import { isCalendarView } from '../calendar';

/**
 * "Back to where you were" for the event board.
 *
 * Every state of /events is a URL (`filters.ts`), so a link from the diary
 * to an event carries that URL as `?back=` and the board offers it as its
 * way home — the week, the filters and the client that were on screen, not a
 * bare /events. A URL rather than `router.back()`: it survives a refresh, a
 * link opened in a new tab and the board's own 60 s re-read, and it is the
 * same on the server as in the browser.
 *
 * Pure, and free of `next/*`, so it is unit-tested directly.
 */

/** `/events/:id`, carrying the diary state it was opened from (if any). */
export function boardHref(href: string, back?: string | null): string {
  const safe = safeBackHref(back);
  return safe ? `${href}?back=${encodeURIComponent(safe)}` : href;
}

/**
 * The `back` param, or null. Only the diary itself is a valid target: a
 * path on this site that starts at /events and stays in the query string,
 * never another origin (`//evil`, `https:`) or another screen.
 */
export function safeBackHref(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > 500) return null;
  if (value !== '/events' && !value.startsWith('/events?')) return null;
  // A backslash or a control character is how a browser is talked into a different path.
  if (value.includes('\\') || [...value].some((ch) => ch.charCodeAt(0) < 32)) return null;
  return value;
}

const VIEW_LABEL = { list: 'list', month: 'month', week: 'week', day: 'day' } as const;

/** "Back to week view" — what the button says, from the view the link carries. */
export function backLabel(href: string | null): string {
  if (!href) return 'Back to scheduling';
  const view = new URL(href, 'https://office.invalid').searchParams.get('view') ?? '';
  return isCalendarView(view) ? `Back to ${VIEW_LABEL[view]} view` : 'Back to scheduling';
}
