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

/**
 * The clock a person reads times on (ADR-0085). 24-hour is the platform
 * default for everyone; a worker or a Back Office user can switch their own
 * view to 12-hour in their settings. It changes how a time is WRITTEN and
 * how a typed time is read — never what is stored (always `timestamptz`) and
 * never a rule (every rule runs on Europe/London instants).
 */
export type TimeFormat = '24h' | '12h';

export const TIME_FORMATS: readonly TimeFormat[] = ['24h', '12h'];
export const DEFAULT_TIME_FORMAT: TimeFormat = '24h';

/** The cookie that carries the choice to server-rendered pages (ADR-0085). */
export const TIME_FORMAT_COOKIE = 'thc-time-format';

/**
 * A day, in seconds. The profile is the record; the cookie is only a cache of
 * it, so a change made on another device reaches this one within a day, and a
 * lapsed one costs a single profile read.
 */
export const TIME_FORMAT_COOKIE_MAX_AGE = 60 * 60 * 24;

export function isTimeFormat(value: unknown): value is TimeFormat {
  return value === '24h' || value === '12h';
}

/** Anything that is not exactly "12h" is the default: a stale or hand-edited value never breaks a page. */
export function parseTimeFormat(value: unknown): TimeFormat {
  return value === '12h' ? '12h' : DEFAULT_TIME_FORMAT;
}

/**
 * "17:00" → "17:00" or "5:00 pm". Built by hand, not by Intl's hour12: ICU
 * 72+ writes a narrow no-break space before "pm" in some engines and a plain
 * one in others, which is a hydration mismatch (the same trap `formatDateIn`
 * avoids for month names). Midnight is "12:00 am", noon "12:00 pm".
 */
export function clockLabel(hhmm: string, format: TimeFormat = DEFAULT_TIME_FORMAT): string {
  if (format === '24h') return hhmm;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const suffix = hour >= 12 && hour < 24 ? 'pm' : 'am';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`;
}

/**
 * Reads a typed time into the "HH:MM" the platform stores and posts, or null
 * when it is not a time. Forgiving on purpose, because it is read from a text
 * field a person types into, in either clock:
 *
 *   "17:00" "1700" "17.00" "17"   → 17:00      "9" "9:5" "0905" → 09:00 / 09:05 / 09:05
 *   "5pm" "5:30 pm" "5.30PM"      → 17:00 / 17:30 / 17:30
 *   "12am" "12 am" → 00:00         "12pm" → 12:00
 *
 * A number with no am/pm is read on the 24-hour clock whichever format the
 * person prefers: "17:00" is unambiguous in both, and "5" typed by a 12-hour
 * person comes straight back as "5:00 am", so the mistake is visible before
 * anything is saved. "24:00" is refused (a role that ends at midnight ends at
 * "00:00", and `ukRoleWindow` rolls it into the next day).
 */
export function parseClock(text: string): string | null {
  let body = text.trim().toLowerCase();
  const suffix = /\s*([ap])\.?m\.?$/.exec(body);
  if (suffix) body = body.slice(0, suffix.index).trim();

  let hour: number;
  let minute: number;
  const split = /^(\d{1,2})[:.](\d{1,2})$/.exec(body);
  const bare = /^\d{1,4}$/.exec(body);
  if (split) {
    // "9:5" is 9:05, as a person means it.
    hour = Number(split[1]);
    minute = Number(split[2]!.padStart(2, '0'));
  } else if (bare) {
    // No separator: the last two digits are the minutes ("1700", "905").
    hour = body.length <= 2 ? Number(body) : Number(body.slice(0, -2));
    minute = body.length <= 2 ? 0 : Number(body.slice(-2));
  } else {
    return null;
  }

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix[1] === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

export function formatTimeIn(
  instant: Date,
  zone: string,
  format: TimeFormat = DEFAULT_TIME_FORMAT,
): string {
  const hhmm = new Intl.DateTimeFormat('en-GB', { ...TIME_OPTS, timeZone: zone }).format(instant);
  return clockLabel(hhmm, format);
}

/** "05 Sep, 09:05" — the day and month words from `formatDateIn`, so the
 *  server and Safari agree on "Sep" (Node's ICU writes "Sept"). */
export function formatDateTimeIn(
  instant: Date,
  zone: string,
  format: TimeFormat = DEFAULT_TIME_FORMAT,
): string {
  const [d = '', m = ''] = formatDateIn(instant, zone).split(' ');
  return `${d.padStart(2, '0')} ${m}, ${formatTimeIn(instant, zone, format)}`;
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
  format: TimeFormat = DEFAULT_TIME_FORMAT,
): DisplayedTime {
  const fmt = (at: Date, z: string) =>
    withDate ? formatDateTimeIn(at, z, format) : formatTimeIn(at, z, format);

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
