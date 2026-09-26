import { checkInWindow } from './phase';

/**
 * The shift screen's three conveniences — directions, tap-to-call and the
 * "Check-in opens in …" countdown (§10.4, §5.1). Pure, and tested in
 * __tests__/links.test.ts. None of them decides anything: the check-in
 * window is `checkInWindow()` from phase.ts, the same one the screen
 * already quotes.
 */

/**
 * A Google Maps directions link to the venue. `maps/dir/?api=1` is the
 * documented cross-platform form: it opens the Google Maps app on Android
 * and iOS where installed, and the web map otherwise. The pin wins over
 * the address where there is one — it is the geofence's own centre, the
 * point check-in measures from. `staff_shift_detail()` returns 0/0 for a
 * venue with no pin (types.ts), and nobody is working in the Gulf of
 * Guinea, so that pair means "no pin".
 */
export function directionsUrl(venue: {
  venueLat?: number | null;
  venueLng?: number | null;
  venueName: string;
  venueAddress: string;
}): string | null {
  const { venueLat: lat, venueLng: lng } = venue;
  const pinned =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);
  const destination = pinned
    ? `${lat},${lng}`
    : [venue.venueName, venue.venueAddress].filter((s) => s.trim() !== '').join(', ');
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export interface ContactPhone {
  /** Text before the number, as the office typed it. */
  before: string;
  /** The number as typed — what the worker reads. */
  display: string;
  /** `tel:+447700900123` — digits and a leading + only (RFC 3966). */
  href: string;
  after: string;
}

/**
 * The phone number inside the free-text on-site contact ("Sam Patel —
 * 07700 900123", "Front desk +44 (0)20 7946 0000"), or null when there is
 * none. Ten to fifteen digits, allowing the spaces, dashes, dots and
 * brackets people type; a UK "+44 (0)" drops its trunk zero, because
 * `tel:+4402…` does not ring.
 */
export function phoneFromContact(contact: string | null | undefined): ContactPhone | null {
  if (!contact) return null;
  // The first run that IS a phone number: "from 12.09.2026, 07700 900123"
  // must skip the date and ring the number.
  for (const match of contact.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) {
    const display = match[0];
    let digits = display.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
    const plus = digits.startsWith('+');
    digits = digits.replace(/\+/g, '');
    if (digits.length < 10 || digits.length > 15) continue;
    const at = match.index ?? 0;
    return {
      before: contact.slice(0, at),
      display,
      href: `tel:${plus ? '+' : ''}${digits}`,
      after: contact.slice(at + display.length),
    };
  }
  return null;
}

/**
 * "2 h 15 min", "3 d 4 h", "45 min", "less than a minute" — how long until
 * an instant. Minutes round UP, so the screen never says "0 min" while the
 * window is still shut.
 */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const totalMin = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

/**
 * "Check-in opens in 2 h 15 min" while the window is still shut, null once
 * it has opened. The window is `checkInWindow()` (start − 30 min, §5.1).
 */
export function checkInCountdown(startsAt: string, now: Date): string | null {
  // The opening depends on the start alone (start − 30 min); the end and
  // the confirmation time move only the lock, which this does not read.
  const opens = checkInWindow({ startsAt, endsAt: startsAt, confirmedAt: null }).opens.getTime();
  const left = opens - now.getTime();
  return left > 0 ? `Check-in opens in ${formatCountdown(left)}` : null;
}
