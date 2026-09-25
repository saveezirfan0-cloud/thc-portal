/**
 * "Add to calendar" on the event page (ADR-0035): an RFC 5545 iCalendar
 * file built in the browser from the event already on the page.
 *
 * Pure: no DOM, no clock of its own — the caller passes the page's origin
 * and the stamp time — so every byte of the file is testable.
 *
 * What goes in is deliberately thin. The event's name, place and scheduled
 * window, the PO number the client gave THC, and a link back to the line-up.
 * NO worker names: the file leaves the portal into whatever calendar the
 * client syncs and shares, and the line-up can change after it is saved,
 * so the link is the one way to see who is coming. NO money: there is none
 * on `PortalEvent` to put in (§11.1).
 */

/** The fields of `PortalEvent` the file uses; nothing else is read. */
export interface CalendarEventInput {
  id: string;
  title: string;
  venueName: string;
  venueAddress: string;
  poNumber: string | null;
  /** The event window (RULE-18: earliest role start → latest role end), ISO. */
  startsAt: string;
  endsAt: string;
}

/** The UID's right-hand side: THC's own domain, so ids never collide. */
export const ICS_UID_DOMAIN = 'thehospitalitycompany.co.uk';

const CRLF = '\r\n';

/**
 * TEXT value escaping (RFC 5545 §3.3.11): backslash first, so the escapes
 * added after it are not escaped again; then `;` and `,`; then every line
 * break, whichever convention it arrived in, as a literal `\n`.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Content-line folding (RFC 5545 §3.1): no line longer than 75 OCTETS,
 * excluding the CRLF; a continuation starts with one space, which counts
 * towards its 75. Octets, not characters — "Café" is five — and a line is
 * never split inside a character's UTF-8 bytes, which is why this walks
 * code points (`for…of`) rather than UTF-16 units.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (octets + size > 75) {
      out.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join(CRLF);
}

/** "20260919T060000Z": the instant in UTC, whatever zone the ISO was written in. */
export function icsUtc(instant: string | Date): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${String(instant)}`);
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/**
 * The whole file, CRLF-terminated.
 *
 * `lineupUrl` is the event page's own address (`window.location.origin` +
 * `/client/events/{id}` in the browser); `stampedAt` is DTSTAMP, required
 * by §3.6.1, and is simply when the file was made.
 */
export function buildIcs(
  event: CalendarEventInput,
  { lineupUrl, stampedAt }: { lineupUrl: string; stampedAt: Date },
): string {
  const location = [event.venueName, event.venueAddress].filter(Boolean).join(', ');
  const description = [
    event.poNumber ? `PO number: ${event.poNumber}` : null,
    `Line-up: ${lineupUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Hospitality Company//Client Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${ICS_UID_DOMAIN}`,
    `DTSTAMP:${icsUtc(stampedAt)}`,
    `DTSTART:${icsUtc(event.startsAt)}`,
    `DTEND:${icsUtc(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * "{title}.ics", with the characters no file system takes (and control
 * characters) replaced, so "Gala / After-party" still downloads.
 */
export function icsFileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').trim();
  return `${safe || 'event'}.ics`;
}

/** The event page's URL for `id`, on the origin the portal is served from. */
export function lineupUrlFor(origin: string, eventId: string): string {
  return `${origin.replace(/\/+$/, '')}/client/events/${encodeURIComponent(eventId)}`;
}
