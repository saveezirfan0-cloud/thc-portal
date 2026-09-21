import { UK_ZONE } from '@thc/domain';

/**
 * Date formatting for the portal (§1.8).
 *
 * Every function here pins `timeZone: UK_ZONE` explicitly, so it renders
 * the same string on the server and in the browser whatever zone either one
 * is in. That is what keeps these safe to call during server rendering —
 * unlike the "your time" line, which depends on the viewer's own zone and
 * therefore lives in `EventWindow`, behind a mount.
 */

/** "Friday 19 September 2026" — the event page's Date field. */
export function ukDateLong(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: UK_ZONE,
  }).format(new Date(iso));
}

/** "Thu 18 Sep 2026" — the list's date cell. */
export function ukDateShort(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: UK_ZONE,
  }).format(new Date(iso));
}
