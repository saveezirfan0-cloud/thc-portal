/**
 * "Add to calendar" — one booked shift as an RFC 5545 VCALENDAR.
 *
 * Pure: the route handler beside this (`calendar.ics/route.ts`) reads the
 * booking through `staff_shift_detail()` and hands the fields in.
 *
 * The rules that matter, and are asserted in __tests__/ics.test.ts:
 *
 *   - DTSTART/DTEND are the ROLE SECTION's window (RULE-18), written in UTC
 *     "Z" form. No TZID, so no VTIMEZONE to get wrong: every calendar app
 *     shows it in the phone's own zone, which is what §1.8 wants for the
 *     worker's own diary.
 *   - UID is stable per BOOKING. Downloading again after the office moves
 *     the time (N11) updates the same entry instead of adding a second one;
 *     a later DTSTAMP is what tells the calendar this copy is newer.
 *   - TEXT values are escaped (§3.3.11) and every line is folded at 75
 *     octets of UTF-8 (§3.1), with CRLF line ends throughout. Venue
 *     addresses carry commas and event titles carry em dashes, so both
 *     rules are hit by ordinary data.
 *   - No money. A calendar syncs to places this app does not control.
 */

export interface IcsShift {
  bookingId: string;
  eventTitle: string;
  roleName: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  venueAddress: string;
  venueLat?: number | null;
  venueLng?: number | null;
  dressCode?: string | null;
  onsiteContact?: string | null;
  /** Absolute link back to the shift screen. */
  url?: string | null;
}

export const ICS_UID_DOMAIN = 'thehospitalitycompany.co.uk';

/** `20260919T160000Z` — RFC 5545 §3.3.5 form #2, UTC. Seconds dropped to 00. */
export function icsDateTime(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: a content line longer than 75 octets is split, and each
 * continuation starts with a single space. Counted in UTF-8 bytes, never
 * splitting a character — "—" is three octets and must stay whole.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  // The first line may hold 75 octets; a continuation 74 after its space.
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildShiftIcs(shift: IcsShift, now: Date = new Date()): string {
  const description = [
    `${shift.eventTitle} · ${shift.roleName}`,
    shift.dressCode ? `Dress code: ${shift.dressCode}` : null,
    shift.onsiteContact ? `On-site contact: ${shift.onsiteContact}` : null,
    'Check in on the THC Staff app when you arrive.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const location = [shift.venueName, shift.venueAddress].filter(Boolean).join(', ');
  const hasGeo =
    typeof shift.venueLat === 'number' &&
    typeof shift.venueLng === 'number' &&
    Number.isFinite(shift.venueLat) &&
    Number.isFinite(shift.venueLng) &&
    !(shift.venueLat === 0 && shift.venueLng === 0);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Hospitality Company//THC Staff//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${shift.bookingId}@${ICS_UID_DOMAIN}`,
    `DTSTAMP:${icsDateTime(now)}`,
    `DTSTART:${icsDateTime(shift.startsAt)}`,
    `DTEND:${icsDateTime(shift.endsAt)}`,
    `SUMMARY:${icsText(`${shift.eventTitle} · ${shift.roleName}`)}`,
    `LOCATION:${icsText(location)}`,
    ...(hasGeo ? [`GEO:${shift.venueLat};${shift.venueLng}`] : []),
    `DESCRIPTION:${icsText(description)}`,
    ...(shift.url ? [`URL:${shift.url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** `thc-shift-2026-09-19.ics` — the UK date the section starts on. */
export function icsFilename(startsAt: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startsAt);
  return `thc-shift-${day}.ics`;
}
