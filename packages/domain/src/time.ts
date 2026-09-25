/**
 * Time-zone display rules — Scope §1.8.
 *
 * Everything is stored as `timestamptz`. Every rule in the platform is
 * evaluated in Europe/London. What differs is the *display*:
 *
 *  - Scheduled times (shift start/end, deadlines) show UK time, plus a second
 *    line in the viewer's zone when that zone is not Europe/London.
 *  - Actual stamps (check-in, check-out) show viewer-local only — the worker
 *    wants to know what their own clock said.
 *  - Manager-typed time inputs are labelled "(UK time)".
 *  - Audit stamps (contract signature, verification) are UK-only, never dual.
 */

export const UK_ZONE = 'Europe/London';

export type TimeDisplayKind = 'scheduled' | 'actual' | 'audit';

export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || UK_ZONE;
}

/** True when the viewer needs the second "your time" line. */
export function needsDualZone(zone: string = viewerZone()): boolean {
  return zone !== UK_ZONE;
}

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

export function formatTimeIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { ...TIME_OPTS, timeZone: zone }).format(instant);
}

/** "05 Sep, 09:05" — the day and month words from `formatDateIn`, so the
 *  server and Safari agree on "Sep" (Node's ICU writes "Sept"). */
export function formatDateTimeIn(instant: Date, zone: string): string {
  const [d = '', m = ''] = formatDateIn(instant, zone).split(' ');
  return `${d.padStart(2, '0')} ${m}, ${formatTimeIn(instant, zone)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface DateLabelOptions {
  weekday?: 'short' | 'long';
  month?: 'short' | 'long';
  /** Defaults to true; false gives "Sep 2026". */
  day?: boolean;
  year?: boolean;
}

/**
 * "Fri 25 Sep 2026" / "Friday 25 September 2026", the same in every engine.
 *
 * `Intl.DateTimeFormat('en-GB', { weekday, month: 'short' }).format()` is
 * not: Node and Chrome say "Fri 25 Sept" or "Fri, 25 Sept", Safari says
 * "Fri, 25 Sep". A string rendered on the server and again in the browser
 * that differs by one comma is a hydration mismatch, and React answers one
 * by re-rendering the page from scratch on the client. Only the numeric
 * parts come from Intl here (they are what the zone decides); the words are
 * ours.
 */
export function formatDateIn(instant: Date, zone: string, opts: DateLabelOptions = {}): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const num = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  const y = num('year');
  const m = num('month');
  const d = num('day');
  const month = MONTHS[m - 1] ?? '';
  const out: string[] = [];
  if (opts.weekday) {
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
    out.push(opts.weekday === 'long' ? wd : wd.slice(0, 3));
  }
  if (opts.day !== false) out.push(String(d));
  out.push(opts.month === 'long' ? month : month.slice(0, 3));
  if (opts.year) out.push(String(y));
  return out.join(' ');
}

/** The short zone name shown next to a dual-zone second line, e.g. "CEST". */
export function zoneLabel(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    timeZoneName: 'short',
  }).formatToParts(instant);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

export interface DisplayedTime {
  /** The line every viewer sees. */
  primary: string;
  /** The "your time" line, present only for scheduled times in a non-UK zone. */
  secondary?: string;
}

/**
 * Renders one instant according to §1.8, given what kind of time it is.
 * `withDate` switches from "18:00" to "14 Jun, 18:00".
 */
export function displayTime(
  instant: Date,
  kind: TimeDisplayKind,
  zone: string = viewerZone(),
  withDate = false,
): DisplayedTime {
  const fmt = withDate ? formatDateTimeIn : formatTimeIn;

  if (kind === 'actual') {
    // The worker's own clock. Never dual.
    return { primary: fmt(instant, zone) };
  }

  if (kind === 'audit') {
    // Signature and verification stamps are UK-only, always.
    return { primary: `${fmt(instant, UK_ZONE)} (UK)` };
  }

  const primary = fmt(instant, UK_ZONE);
  if (!needsDualZone(zone)) return { primary };
  return { primary: `${primary} (UK)`, secondary: `${fmt(instant, zone)} your time` };
}

/** The label a manager-typed time input must carry (§1.8). */
export const UK_INPUT_SUFFIX = '(UK time)';

export function ukInputLabel(label: string): string {
  return `${label} ${UK_INPUT_SUFFIX}`;
}

/**
 * A Europe/London wall-clock time, as the instant it names.
 *
 * Managers type "17:00" and mean 17:00 in London, whatever the server's or
 * the browser's zone is (§1.8). This is the inverse of `formatTimeIn`: it
 * turns the typed date + time back into the `timestamptz` that gets stored.
 *
 * The offset is read from the zone itself rather than assumed, so the two
 * BST changeovers are handled: the guess is corrected once, which is enough
 * for a one-hour shift in either direction.
 */
export function ukInstant(isoDate: string, time: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) {
    throw new RangeError(`Not a UK date and time: ${isoDate} ${time}`);
  }
  const wallClock = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const firstPass = wallClock - ukOffsetMs(new Date(wallClock));
  const offset = ukOffsetMs(new Date(firstPass));
  return new Date(wallClock - offset);
}

/** How far ahead of UTC Europe/London is at `instant`, in milliseconds. */
function ukOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instants a role section's typed start and end resolve to (§3.2).
 *
 * A role may end after midnight — 17:00–01:30 runs into the next day — so an
 * end that is not after the start on the event's own date rolls forward one
 * day. An end equal to the start does not roll: a zero-length section is a
 * validation error, not a 24-hour shift.
 */
export function ukRoleWindow(
  isoDate: string,
  start: string,
  end: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = ukInstant(isoDate, start);
  const sameDayEnd = ukInstant(isoDate, end);
  if (sameDayEnd > startsAt || end === start) return { startsAt, endsAt: sameDayEnd };
  return { startsAt, endsAt: ukInstant(nextDay(isoDate), end) };
}

function nextDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return next.toISOString().slice(0, 10);
}
