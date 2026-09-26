import { UK_ZONE, formatDateIn } from '@thc/domain';

/**
 * Date formatting for the portal (§1.8).
 *
 * Every function here pins `timeZone: UK_ZONE` explicitly, so it renders
 * the same string on the server and in the browser whatever zone either one
 * is in. That is what keeps these safe to call during server rendering —
 * unlike the "your time" line, which depends on the viewer's own zone and
 * therefore lives in `EventWindow`, behind a mount. The one exception,
 * `daysLaterIn`, takes its zone from the caller for exactly that reason.
 */

/** "Friday 19 September 2026" — the event page's Date field. */
export function ukDateLong(iso: string): string {
  // formatDateIn, not Intl.format(): Node wrote "Friday, 25 September" and
  // Safari "Friday 25 September", and that comma was a hydration mismatch
  // that re-rendered the page and wiped the theme off <html>.
  return formatDateIn(new Date(iso), UK_ZONE, { weekday: 'long', month: 'long', year: true });
}

/** "Thu 18 Sep 2026" — the list's date cell. */
export function ukDateShort(iso: string): string {
  return formatDateIn(new Date(iso), UK_ZONE, { weekday: 'short', year: true });
}

/**
 * How many calendar days an end falls after its start on the wall clock of
 * `zone`: 0 for a same-day window, 1 for 17:00–01:30 (ADR-0050).
 *
 * Each line of a window is judged in its own zone: 07:00–23:30 in London is
 * one day, while the same instants in Dubai run 10:00–02:30 and cross
 * midnight. The zone's own calendar dates are compared as whole days, so a
 * BST↔GMT change inside the window (a 23- or 25-hour day) can neither add
 * nor lose one the way dividing the elapsed hours by 24 would.
 *
 * The zone is an argument rather than pinned to UK_ZONE, but the function
 * is pure: given the same zone it answers the same on server and browser.
 * Which zone to pass, and when, is `EventWindow`'s business.
 */
export function daysLaterIn(startsAt: string | Date, endsAt: string | Date, zone: string): number {
  return Math.max(0, dayNumberIn(new Date(endsAt), zone) - dayNumberIn(new Date(startsAt), zone));
}

/** " (+1 day)", " (+2 days)", or nothing for a same-day window. */
export function dayMarker(days: number): string {
  if (days <= 0) return '';
  return days === 1 ? ' (+1 day)' : ` (+${days} days)`;
}

/** The calendar date `instant` falls on in `zone`, as days since 1970-01-01. */
function dayNumberIn(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const num = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(num('year'), num('month') - 1, num('day')) / 86_400_000;
}
