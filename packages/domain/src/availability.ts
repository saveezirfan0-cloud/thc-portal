/**
 * Worker availability — ADR-0042, docs/19 §1 (an addition to Scope v1.6:
 * §1.5 StaffUnavailability, §3.3 the Unavailable reason, §3.4 and §6 a gate
 * on automated invitations, §9.6, §10.1).
 *
 * A worker marks days or times they cannot work. Each entry is one
 * `staff_unavailability` row holding a half-open `tstzrange`. The rules that
 * are easy to get wrong, and are therefore asserted by
 * availability.vectors.json in Vitest here and in pgTAP 701 against
 * `unavailability_range()` / `staff_unavailable()`:
 *
 *   - Entries are typed in UK time (§1.8, "(UK time)"). An all-day entry is
 *     UK midnight to UK midnight, so it is 23 h on the spring changeover day
 *     and 25 h on the autumn one — never "24 hours from 00:00 UTC".
 *   - A time window whose end is at or before its start on one date runs
 *     overnight into the next UK date. From == to is not a window at all.
 *   - A weekly repeat keeps the wall-clock time: 18:00 UK stays 18:00 UK
 *     across the October changeover, so each copy is built from its own
 *     date, never by adding 7 × 24 h.
 *   - The range is half-open, and the overlap is tested against the ROLE
 *     SECTION's window (RULE-18), never the event's: an entry ending at
 *     17:00 does not touch a section starting at 17:00.
 *
 * It is a hard gate for what the MACHINE does — hourly rounds, the first
 * round, cutoff refills, same-day escalation, offer pushes — and only that
 * (ADR-0042). A manager can still invite by hand after a confirm, the worker
 * can still accept, apply and take an offer, and nothing here ever cancels
 * a confirmed booking. The five §6 weights are contractual, so availability
 * is not a sixth score: `HARD_GATES` in scoring.ts is unchanged and the
 * overlay below sets the gate on a candidate row the SQL pool left ungated.
 */

import type { CandidateRow } from './autoAssign.ts';
import { UK_ZONE, ukInstant } from './time.ts';

/** The gate name a calendar entry puts on a candidate row. */
export const CALENDAR_GATE = 'unavailable' as const;

/** One entry spans at most 31 UK calendar days (Q10). */
export const UNAVAILABILITY_MAX_DAYS = 31;
/** Entries may start at most 365 days ahead (Q10: "up to 12 months"). */
export const UNAVAILABILITY_MAX_AHEAD_DAYS = 365;
/** "Repeat weekly for N weeks": N extra weekly copies, at most 26 (Q10). */
export const UNAVAILABILITY_MAX_REPEATS = 26;
/** A worker holds at most 200 future entries. */
export const UNAVAILABILITY_MAX_FUTURE_ROWS = 200;

export const UNAVAILABILITY_REFUSALS = [
  'bad_window',
  'in_past',
  'too_far',
  'too_long',
  'too_many',
] as const;

export type UnavailabilityRefusal = (typeof UNAVAILABILITY_REFUSALS)[number];

/** What the Add sheet sends: UK dates `YYYY-MM-DD` and UK times `HH:MM`. */
export interface UnavailabilityInput {
  fromDate: string;
  /** Defaults to `fromDate`. */
  toDate?: string | null;
  /** Both null = all day; both set = a window; one alone is `bad_window`. */
  fromTime?: string | null;
  toTime?: string | null;
  /** Extra weekly copies after the first. 0 (the default) = just this one. */
  repeatWeeks?: number;
  /** The worker's future entries already held, for the 200 ceiling. */
  existingFuture?: number;
}

/** A half-open period `[start, end)`. */
export interface UnavailablePeriod {
  start: Date;
  end: Date;
  allDay: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

function isRealDate(iso: string): boolean {
  if (!DATE.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.toISOString().slice(0, 10) === iso;
}

/** A civil date moved by whole days, in UTC where every day is 24 h. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The UK civil date of an instant, `YYYY-MM-DD`. */
function ukDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** A UK wall-clock reading as a plain number, for "how many UK days long". */
function wallClock(isoDate: string, time: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y!, m! - 1, d!, hh!, mm!);
}

interface Normalised {
  fromDate: string;
  toDate: string;
  fromTime: string | null;
  toTime: string | null;
  /** The UK date the end falls on (the next day for an overnight window). */
  endDate: string;
}

function normalise(input: UnavailabilityInput): Normalised | null {
  const fromDate = input.fromDate;
  const toDate = input.toDate ?? fromDate;
  const fromTime = input.fromTime ?? null;
  const toTime = input.toTime ?? null;
  if (!isRealDate(fromDate) || !isRealDate(toDate) || toDate < fromDate) return null;
  if ((fromTime === null) !== (toTime === null)) return null;
  if (fromTime === null || toTime === null) {
    return { fromDate, toDate, fromTime: null, toTime: null, endDate: addDays(toDate, 1) };
  }
  if (!TIME.test(fromTime) || !TIME.test(toTime)) return null;
  if (toDate === fromDate) {
    if (toTime === fromTime) return null;
    // `to <= from` on one date: the window runs overnight.
    const endDate = toTime < fromTime ? addDays(fromDate, 1) : fromDate;
    return { fromDate, toDate, fromTime, toTime, endDate };
  }
  return { fromDate, toDate, fromTime, toTime, endDate: toDate };
}

function build(n: Normalised): UnavailablePeriod | null {
  const allDay = n.fromTime === null;
  const start = ukInstant(n.fromDate, n.fromTime ?? '00:00');
  const end = ukInstant(n.endDate, n.toTime ?? '00:00');
  if (end.getTime() <= start.getTime()) return null;
  return { start, end, allDay };
}

/**
 * The period one entry covers — the TS half of `unavailability_range()`.
 * Null is `bad_window`: an impossible date, `to` before `from`, one time
 * without the other, or from == to on one date.
 */
export function unavailabilityRange(input: UnavailabilityInput): UnavailablePeriod | null {
  const n = normalise(input);
  return n ? build(n) : null;
}

/**
 * The entry and its `repeatWeeks` weekly copies, each built from its own UK
 * dates so the wall-clock time survives a DST changeover. Null is
 * `bad_window`.
 */
export function expandWeekly(input: UnavailabilityInput): UnavailablePeriod[] | null {
  const repeats = input.repeatWeeks ?? 0;
  if (!Number.isInteger(repeats) || repeats < 0) return null;
  const out: UnavailablePeriod[] = [];
  for (let week = 0; week <= repeats; week += 1) {
    const period = unavailabilityRange({
      ...input,
      fromDate: isRealDate(input.fromDate) ? addDays(input.fromDate, 7 * week) : input.fromDate,
      toDate:
        input.toDate && isRealDate(input.toDate) ? addDays(input.toDate, 7 * week) : input.toDate,
    });
    if (!period) return null;
    out.push(period);
  }
  return out;
}

/**
 * Whether an entry touches a role section (RULE-18: the section's own
 * window, never the event's). Half-open on both sides, exactly Postgres's
 * `tstzrange && tstzrange`: an entry ending 17:00 misses a 17:00 start.
 */
export function overlapsSection(
  period: Pick<UnavailablePeriod, 'start' | 'end'>,
  section: { startsAt: Date; endsAt: Date },
): boolean {
  return (
    period.start.getTime() < section.endsAt.getTime() &&
    section.startsAt.getTime() < period.end.getTime()
  );
}

export type UnavailabilityValidation =
  { ok: true; periods: UnavailablePeriod[] } | { ok: false; reason: UnavailabilityRefusal };

/**
 * The Add sheet's decision, in the order the refusal is reported:
 * `bad_window` › `in_past` › `too_far` › `too_long` › `too_many`.
 *
 *   in_past   the entry starts on a UK date before today, or ends by now
 *   too_far   any copy starts more than 365 days after today (UK)
 *   too_long  one entry spans more than 31 UK calendar days
 *   too_many  more than 26 repeats, or more than 200 future entries in all
 *
 * `add_my_unavailability()` (docs/19 §1, Agent B) makes the same refusals.
 */
export function validateUnavailability(
  input: UnavailabilityInput,
  now: Date = new Date(),
): UnavailabilityValidation {
  const n = normalise(input);
  const repeats = input.repeatWeeks ?? 0;
  if (!n || !Number.isInteger(repeats) || repeats < 0) return { ok: false, reason: 'bad_window' };
  const periods = expandWeekly(input);
  if (!periods || periods.length === 0) return { ok: false, reason: 'bad_window' };

  const today = ukDate(now);
  if (n.fromDate < today || periods[0]!.end.getTime() <= now.getTime()) {
    return { ok: false, reason: 'in_past' };
  }
  const lastStart = addDays(n.fromDate, 7 * repeats);
  if (lastStart > addDays(today, UNAVAILABILITY_MAX_AHEAD_DAYS)) {
    return { ok: false, reason: 'too_far' };
  }
  const span =
    wallClock(n.endDate, n.toTime ?? '00:00') - wallClock(n.fromDate, n.fromTime ?? '00:00');
  if (span > UNAVAILABILITY_MAX_DAYS * DAY_MS) return { ok: false, reason: 'too_long' };
  if (
    repeats > UNAVAILABILITY_MAX_REPEATS ||
    (input.existingFuture ?? 0) + periods.length > UNAVAILABILITY_MAX_FUTURE_ROWS
  ) {
    return { ok: false, reason: 'too_many' };
  }
  return { ok: true, periods };
}

/**
 * Overlays the calendar gate on candidate rows (ADR-0042). A row the SQL
 * pool already gated keeps its own gate — "wrong role" or "blocked" is the
 * truer reason — and an ungated row whose worker is unavailable for the
 * section gets `unavailable`, which `rankPool` then drops like any gate.
 * `unavailable` holds the staff ids `auto_assign_unavailable(shift)` returns.
 */
export function withAvailability<R extends CandidateRow>(
  rows: readonly R[],
  unavailable: Iterable<string>,
): R[] {
  const ids = new Set(unavailable);
  if (ids.size === 0) return [...rows];
  return rows.map((row) =>
    row.gate === null && ids.has(row.staff_id) ? { ...row, gate: CALENDAR_GATE } : row,
  );
}
