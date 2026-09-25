import {
  CHECK_IN_OPENS_MIN,
  UK_ZONE,
  UK_ZONE_LABEL,
  addMinutes,
  cancelDeadline,
  formatTimeIn,
  needsDualZone,
  shiftCard,
} from '@thc/domain';
import type { ReconfirmField, StaffBooking } from '@thc/domain';

/**
 * The My shifts list — Scope §10.4, wireframes/staff/shifts.html.
 *
 * Pure rules for the list screen, kept out of the page so each can be
 * pinned: which bookings are listed, what the nav badge counts, and the
 * worker-facing words for a few things the database stores as codes.
 */

/**
 * Which bookings My shifts lists (§10.4, §3.6).
 *
 * "Booked; the three-stage confirmation" — the list is today's and the
 * upcoming shifts, and the wireframe draws nothing older. The one finished
 * booking the scope keeps on the list is the No check-out one: "it remains
 * visible in My shifts, showing this static screen in place of the normal
 * check-out controls, until a manager resolves the violation". Every other
 * `past` card — worked, or confirmed and never checked into — belongs to
 * Earnings history (§10.1), not here.
 */
export function myShifts<T extends StaffBooking>(bookings: readonly T[], now = new Date()): T[] {
  return bookings.filter((b) => {
    if (b.status !== 'confirmed' && b.status !== 'worked') return false;
    return shiftCard(b, now) !== 'past' || b.noCheckoutOpen;
  });
}

/**
 * The number on the Shifts tab (§10.4 "My shifts · N!").
 *
 * The wireframe's caption "3 need action", segment "My shifts 3!" and
 * bottom-nav badge "Shifts 3" are one number while four cards are listed:
 * the badge counts the cards awaiting the worker — stage 2 "I'm ready" and
 * a changed time — not the shifts they hold.
 */
export function shiftsBadge(bookings: readonly StaffBooking[], now = new Date()): number {
  return myShifts(bookings, now).filter((b) => {
    const card = shiftCard(b, now);
    return card === 'needs_ready' || card === 'reconfirm';
  }).length;
}

/**
 * The "Time changed" card's line (§3.5, N11): "Start time moved by the
 * office (was 09:00–14:00)".
 *
 * The office stores `reconfirm_reason` as the comma-joined field codes it
 * changed (`starts_at,ends_at`, `dress_code`, …), which is what triggers
 * N11 — it is not a sentence, and a worker must never read a column name.
 * An optional ` (was …)` suffix, when the office records the previous
 * window, is carried through. Anything that is not made of codes is
 * assumed to already be a sentence and is shown as it is.
 */
export function describeReconfirm(reason: string | null | undefined): string {
  const fallback = 'The office changed this shift.';
  if (!reason || !reason.trim()) return fallback;

  const wasAt = reason.indexOf(' (was ');
  const codesPart = wasAt >= 0 ? reason.slice(0, wasAt) : reason;
  const was = wasAt >= 0 ? reason.slice(wasAt + ' (was '.length).replace(/\)\s*$/, '') : null;

  const codes = codesPart
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const known = codes.filter((c): c is ReconfirmField => c in RECONFIRM_WORDS);
  if (known.length === 0 || known.length !== codes.length) return reason;

  const phrases: string[] = [];
  const start = known.includes('starts_at');
  const end = known.includes('ends_at');
  if (start && end) phrases.push('Start and end time moved by the office');
  else if (start) phrases.push(RECONFIRM_WORDS.starts_at);
  else if (end) phrases.push(RECONFIRM_WORDS.ends_at);
  for (const code of known) {
    if (code === 'starts_at' || code === 'ends_at') continue;
    if (!phrases.includes(RECONFIRM_WORDS[code])) phrases.push(RECONFIRM_WORDS[code]);
  }
  const sentence = phrases.join(' · ');
  return was ? `${sentence} (was ${was})` : sentence;
}

const RECONFIRM_WORDS: Record<ReconfirmField, string> = {
  starts_at: 'Start time moved by the office',
  ends_at: 'End time moved by the office',
  event_date: 'Date moved by the office',
  venue_address: 'Venue changed by the office',
  dress_code: 'Dress code changed by the office',
};

/**
 * The outward half of a UK postcode at the end of an address — "RH17" from
 * "Hurst Manor, Cuckfield RH17 5LB" — for the open-shift card's venue line
 * "Hurst Manor, RH17 · 38 km" (§10.4 wireframe). Null when the address
 * carries none, in which case the card prints the name alone.
 */
export function outwardCode(address: string | null | undefined): string | null {
  if (!address) return null;
  const full = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b\s*$/i.exec(address.trim());
  if (full) return full[1]!.toUpperCase();
  const outward = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*$/i.exec(address.trim());
  return outward ? outward[1]!.toUpperCase() : null;
}

/** "Hurst Manor, RH17" — the venue line with its outward code, if any. */
export function venueLine(venueName: string, venueAddress: string | null | undefined): string {
  const outward = outwardCode(venueAddress);
  return outward ? `${venueName}, ${outward}` : venueName;
}

/**
 * "Cancel available until Sat 20, 16:00 (72 h before start)" — RULE-04 as
 * the wireframe words it. A scheduled time, so it carries "UK time" and a
 * "your time" second line only for a viewer outside the UK (§1.8); the UK
 * viewer reads the wireframe's line as it is.
 */
export function cancelUntilLine(
  startsAt: Date,
  zone: string = UK_ZONE,
): { primary: string; secondary?: string } {
  const deadline = cancelDeadline(startsAt);
  const primary = `Cancel available until ${formatDayTime(deadline, UK_ZONE)} (72 h before start)`;
  if (!needsDualZone(zone)) return { primary };
  return { primary, secondary: `${formatDayTime(deadline, zone)} your time` };
}

function formatDayTime(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * "Confirm by 12:00 today — or you'll be removed from this shift." (§3.5,
 * N6). The card only ever renders from 00:00 UK on the day before, so the
 * deadline is always "today" to the worker; "the day before" would read as
 * if another day remained.
 */
export const READY_DEADLINE_LINE = { before: 'Confirm by ', deadline: '12:00 today (UK time)' };

export type CapBasis = 'term' | 'holiday' | 'completion' | 'opt_out' | 'rtw';

/**
 * The Limit reached card's sentence (§10.4, RULE-20): "This 8 h shift would
 * take you over your 20 h/week limit (term time until 13.12.2026)". The
 * basis and its boundary date are what let a worker tell a term boundary
 * from an office mistake (§4.4); they are appended whenever the row carries
 * them.
 */
export function limitSentence(input: {
  shiftHours: number;
  capHours: number | null;
  basis?: CapBasis | null;
  until?: string | null;
}): string | null {
  if (input.capHours === null) return null;
  const hours = Math.round(input.shiftHours * 10) / 10;
  const cap = Math.round(input.capHours * 10) / 10;
  const basis = input.basis ? CAP_BASIS_WORDS[input.basis] : null;
  const until = input.until ? ` until ${ukDate(input.until)}` : '';
  const why = basis ? ` (${basis}${until})` : '';
  return `This ${hours} h shift would take you over your ${cap} h/week limit${why}`;
}

const CAP_BASIS_WORDS: Record<CapBasis, string> = {
  term: 'term time',
  holiday: 'university holiday',
  completion: 'course completed',
  opt_out: '48-hour opt-out',
  rtw: 'right to work',
};

function ukDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * The line under the today card's check-in button (§10.4 wireframe):
 * "Check-in opens now · shift starts in 2 h 28 m", or, before the window,
 * "Check-in opens at 16:30 UK time · shift starts in 2 h 58 m". The window
 * is §5.1's 30 minutes, measured from the ROLE start (RULE-18).
 */
export function checkInCaption(startsAt: Date, now: Date = new Date()): string {
  const opens = addMinutes(startsAt, -CHECK_IN_OPENS_MIN);
  const startsIn = startsAt.getTime() - now.getTime();
  const tail = startsIn > 0 ? `shift starts in ${formatCountdown(startsIn)}` : 'shift has started';
  if (now.getTime() >= opens.getTime()) return `Check-in opens now · ${tail}`;
  return `Check-in opens at ${formatTimeIn(opens, UK_ZONE)} ${UK_ZONE_LABEL} · ${tail}`;
}

function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
