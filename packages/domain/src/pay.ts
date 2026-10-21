/**
 * The day of the shift — Scope §5.1, §5.2, §5.2b and RULE-01 / 02 / 14 / 15.
 *
 * Pure functions over instants and minutes. Postgres repeats every one of them
 * (`check_in_decision`, `check_out_decision`, `payable_minutes`,
 * `turned_away_minutes` in migration 0006) because the rules have to hold for a
 * worker pressing a button, for the payroll view and for a background job
 * alike. `pay.vectors.json` is the contract between the two: Vitest reads it
 * directly, pgTAP reads the file generated from it. Neither implementation is
 * allowed to be the exception.
 *
 * The rules, in the scope's own terms:
 *
 *  §5.1 check-in. Opens 30 minutes before the role section's start and needs a
 *    GPS fix inside the venue geofence. A press after the start is Late, with
 *    the minutes counted from the actual press. At start+30 the grace has
 *    elapsed: the worker becomes an automatic No-show and the button locks —
 *    only a manager's "Get back" can register their arrival after that. One
 *    exception: a booking confirmed AFTER the shift had already started (a
 *    replacement from the §3.4 escalation) is never auto-locked, because a
 *    window measured from a start they were not booked for means nothing.
 *
 *  §5.1 check-out. Open from the scheduled start until four hours after the
 *    scheduled end, FROM ANYWHERE. The geofence decides only which timestamp
 *    is recorded: on site, the press; off site, the last on-site fix from
 *    background tracking. When there is no on-site fix after check-in the only
 *    candidate would be the check-in itself, i.e. a zero-length shift, so the
 *    No check-out violation is raised on the press instead (RULE-02).
 *
 *  RULE-01 pay window. Payable time is the intersection of [check-in,
 *    check-out] with the scheduled [start, end] — with one deliberate
 *    exception at the end (ADR-0184, THC 21.10.2026). The two graces are
 *    not symmetric in effect:
 *      - check-in on or before the start is paid FROM THE SCHEDULED START;
 *      - check-in after it is paid from the ACTUAL time, grace or not (ADR-0095);
 *      - check-out at or before end+15 is paid TO THE SCHEDULED END: the
 *        15-minute check-out grace pays and charges 16:00, not 16:10;
 *      - check-out MORE than 15 minutes after the end (up to end+4 h, when
 *        RULE-02 takes over) is paid AND charged to the ACTUAL recorded
 *        finish — the on-site press, the last on-site fix when pressed off
 *        site, or the finish a manager enters resolving a No check-out. The
 *        minutes past the scheduled end are the OVERRUN (`overrunMin`): the
 *        same hourly pay and charge rates, its own line on the client's
 *        invoice, and a "Signed out late" flag the office verifies with the
 *        worker afterwards. The flag never holds payroll or the invoice.
 *        The paid end is capped at end+4 h (a manager-entered finish later
 *        than that is not paid beyond it), and the rule applies only to
 *        sections ending on or after `OVERRUN_PAID_FROM` (21.10.2026 UK);
 *        earlier ones keep "paid to the scheduled end".
 *    A check-in at or after the scheduled end intersects nothing and stays
 *    undetermined: the overrun extends a shift that reached its end, it
 *    never makes one.
 *
 *  RULE-02 no check-out. Four hours after the scheduled end with no check-out,
 *    the button locks and a violation is raised. The payable time is
 *    UNDETERMINED — never a silent default to the scheduled finish. It settles
 *    only when a manager enters the actual finish time.
 *
 *  RULE-14 four-hour minimum. A floor on the payable time of someone who
 *    actually worked. A "Left early" violation blocks it whether or not it has
 *    been resolved; a "No check-out" violation blocks it only while it is
 *    unresolved, and resolving it puts the floor back.
 *
 *  RULE-15 buffer turn-away. Past the headcount under a strict buffer policy,
 *    a worker is turned away: a flat four hours if their logged attempt was on
 *    time, nothing if it was late. The attempt timestamp decides, not a
 *    check-in they never made.
 */

/** §5.1. The check-in button appears this long before the scheduled start. */
export const CHECK_IN_OPENS_MIN = 30;

/**
 * §5.1. The grace after the start is [start, start+30): a press inside it is
 * Late, and at start+30 exactly the grace has elapsed — check-in locks
 * ("Check-in window 16:30 – 17:30" for a 17:00 start) and a turn-away at that
 * instant counts as late for RULE-15.
 */
export const CHECK_IN_GRACE_MIN = 30;

/**
 * §5.2 and ADR-0184. Up to this many minutes past the scheduled end, a
 * check-out is paid and charged to the scheduled end. Past it, the shift is
 * paid and charged to the actual recorded finish and flagged "Signed out
 * late" for the office to verify with the worker (never a hold).
 */
export const CHECK_OUT_FLAG_MIN = 15;

/** §5.2. At this point past the end, RULE-02 takes over. */
export const NO_CHECK_OUT_AFTER_MIN = 4 * 60;

/** RULE-14 and RULE-15. The floor, and the flat turn-away payment, in minutes. */
export const MINIMUM_SHIFT_MIN = 4 * 60;

/**
 * RULE-15: what an on-time turn-away is paid, in minutes — the "4 hours" in
 * `TURNED_AWAY_COPY.onTime`. A flat figure of its own, not the RULE-14
 * shift floor: the two are both four hours today, but they are different
 * rules and one may move without the other. `turnedAwayMinutes()` below
 * and SQL's `turned_away_minutes()` return this inside the grace.
 */
export const TURN_AWAY_PAY_MIN = 4 * 60;

/**
 * §9.5 "Left early" (audit D5, ADR-0035). A check-out pressed more than this
 * long before the scheduled end is an early finish and raises the violation
 * that blocks RULE-14's floor. Inside it, the minutes are still deducted by
 * RULE-01 — only the flag waits, mirroring the 15-minute check-out grace.
 */
export const LEFT_EARLY_GRACE_MIN = 15;

/**
 * RULE-02 review of a stale fix (audit D15, ADR-0035). Off site, a last
 * on-site fix more than this long before the press AND before the scheduled
 * end is recorded as the finish but raises a No check-out for a manager to
 * confirm: with screen-open pings only, it may be nothing more than the ping
 * sent right after check-in.
 */
export const STALE_FIX_MIN = 30;

export interface ShiftWindow {
  /** Scheduled start of the ROLE SECTION, never the event window (RULE-18). */
  startsAt: Date;
  endsAt: Date;
}

const MS_PER_MIN = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_MIN;
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MS_PER_MIN);
}

// ---------------------------------------------------------------------------
// §5.1 · check-in
// ---------------------------------------------------------------------------

export type CheckInDecision =
  'too_early' | 'out_of_radius' | 'turned_away' | 'locked' | 'checked_in' | 'checked_in_late';

/** The `checklog_outcome` written for this press, or null when nothing is logged. */
export type CheckLogOutcome = 'checked_in' | 'turned_away' | 'out_of_radius';

export interface CheckInInput {
  shift: ShiftWindow;
  /** The button press. */
  at: Date;
  /** A GPS fix inside the venue's geofence radius (§9.11). */
  insideGeofence: boolean;
  /** `bookings.confirmed_at`. After the start, the No-show lock does not apply. */
  confirmedAt: Date | null;
  /** Successful check-ins already logged against this role section. */
  slotsFilled: number;
  /** RULE-15: only the first `headcount` work; the buffer is not a place. */
  headcount: number;
  /** The client does NOT pay the buffer, so the strict policy applies (§3.2). */
  strictBuffer: boolean;
}

export interface CheckInResult {
  decision: CheckInDecision;
  /** True only when the worker is now on shift. */
  accepted: boolean;
  logOutcome: CheckLogOutcome | null;
  /** The press was after the scheduled start, whatever the decision. */
  late: boolean;
  minutesLate: number;
  /** RULE-15 money. Null for every decision but `turned_away`. */
  turnAwayPayMin: number | null;
  messageKey: string;
}

/**
 * RULE-15. A turn-away's pay is decided by the attempt alone: a flat four
 * hours inside the grace, nothing once it has elapsed. It is not half the
 * shift and not tied to the shift's length.
 */
export function turnedAwayMinutes(shift: ShiftWindow, attemptAt: Date): number {
  const graceEnds = addMinutes(shift.startsAt, CHECK_IN_GRACE_MIN);
  return attemptAt < graceEnds ? TURN_AWAY_PAY_MIN : 0;
}

/**
 * §5.1. The gate order is load-bearing and documented in `pay.vectors.json`:
 * too early → off site → turned away → locked → checked in. The turn-away sits
 * above the lock because RULE-15 itself prices "a worker turned away who was
 * themselves late", which could never happen if the lock fired first.
 */
export function checkInDecision(input: CheckInInput): CheckInResult {
  const { shift, at, insideGeofence, confirmedAt, slotsFilled, headcount, strictBuffer } = input;

  const minutesFromStart = minutesBetween(shift.startsAt, at);
  const late = minutesFromStart > 0;
  const minutesLate = late ? Math.floor(minutesFromStart) : 0;

  const base = { late, minutesLate, turnAwayPayMin: null } as const;

  if (at < addMinutes(shift.startsAt, -CHECK_IN_OPENS_MIN)) {
    return {
      ...base,
      decision: 'too_early',
      accepted: false,
      logOutcome: null,
      messageKey: 'check_in_not_open',
    };
  }

  if (!insideGeofence) {
    return {
      ...base,
      decision: 'out_of_radius',
      accepted: false,
      logOutcome: 'out_of_radius',
      messageKey: 'out_of_radius',
    };
  }

  if (strictBuffer && slotsFilled >= headcount) {
    const turnAwayPayMin = turnedAwayMinutes(shift, at);
    return {
      late,
      minutesLate,
      decision: 'turned_away',
      accepted: false,
      logOutcome: 'turned_away',
      turnAwayPayMin,
      messageKey: turnAwayPayMin > 0 ? 'turned_away_paid' : 'turned_away_unpaid',
    };
  }

  // The lock: start+30 with no check-in is an automatic No-show. A booking
  // confirmed after the shift had started keeps the button until the shift
  // ends instead — that worker may be crossing London.
  const confirmedAfterStart = confirmedAt !== null && confirmedAt > shift.startsAt;
  const locksAt = confirmedAfterStart
    ? shift.endsAt
    : addMinutes(shift.startsAt, CHECK_IN_GRACE_MIN);
  if (at >= locksAt) {
    return {
      ...base,
      decision: 'locked',
      accepted: false,
      logOutcome: null,
      messageKey: 'no_show_locked',
    };
  }

  return {
    late,
    minutesLate,
    decision: late ? 'checked_in_late' : 'checked_in',
    accepted: true,
    logOutcome: 'checked_in',
    turnAwayPayMin: null,
    messageKey: late ? 'checked_in_late' : 'checked_in',
  };
}

// ---------------------------------------------------------------------------
// §5.1 · check-out
// ---------------------------------------------------------------------------

export type CheckOutDecision =
  'not_started' | 'recorded_on_site' | 'recorded_last_on_site' | 'no_on_site_fix' | 'locked';

export interface CheckOutInput {
  shift: ShiftWindow;
  /** The button press. */
  at: Date;
  insideGeofence: boolean;
  /** The worker is checked in; this is when. */
  checkInAt: Date;
  /** The last background-tracking fix inside the geofence after check-in. */
  lastOnSiteAt: Date | null;
}

export interface CheckOutResult {
  decision: CheckOutDecision;
  /** The timestamp RULE-01 then prices. Null when nothing was recorded. */
  recordedAt: Date | null;
  violation: 'none' | 'no_checkout';
  messageKey: string;
  /**
   * §9.5 "Left early": the check-out was pressed more than
   * `LEFT_EARLY_GRACE_MIN` before the scheduled end (D5). Raised alongside
   * whatever `violation` says; false when the press recorded nothing.
   */
  leftEarly: boolean;
}

/** True once the shift is old enough that a missing check-out is RULE-02, not lateness. */
export function isNoCheckOut(shift: ShiftWindow, now: Date): boolean {
  return now >= addMinutes(shift.endsAt, NO_CHECK_OUT_AFTER_MIN);
}

export function checkOutDecision(input: CheckOutInput): CheckOutResult {
  const { shift, at, insideGeofence, checkInAt, lastOnSiteAt } = input;

  if (at < shift.startsAt) {
    return {
      decision: 'not_started',
      recordedAt: null,
      violation: 'none',
      messageKey: 'check_out_not_open',
      leftEarly: false,
    };
  }

  if (isNoCheckOut(shift, at)) {
    // RULE-02, first trigger. The button is locked; only a manager closes this.
    return {
      decision: 'locked',
      recordedAt: null,
      violation: 'no_checkout',
      messageKey: 'no_check_out_locked',
      leftEarly: false,
    };
  }

  // D5: the worker said they had finished, before the scheduled end.
  const leftEarly = at < addMinutes(shift.endsAt, -LEFT_EARLY_GRACE_MIN);

  if (insideGeofence) {
    return {
      decision: 'recorded_on_site',
      recordedAt: at,
      violation: 'none',
      messageKey: 'checked_out',
      leftEarly,
    };
  }

  if (lastOnSiteAt !== null) {
    // D15: the fix is still what is recorded, and what the §5.1 message
    // quotes, but a manager confirms a fix that is stale on both counts.
    const stale =
      minutesBetween(lastOnSiteAt, at) > STALE_FIX_MIN &&
      minutesBetween(lastOnSiteAt, shift.endsAt) > STALE_FIX_MIN;
    return {
      decision: 'recorded_last_on_site',
      recordedAt: lastOnSiteAt,
      violation: stale ? 'no_checkout' : 'none',
      messageKey: 'checked_out_off_site',
      leftEarly,
    };
  }

  // RULE-02, second trigger. The only candidate left is the check-in itself,
  // which would record a zero-length shift, so a manager confirms instead.
  return {
    decision: 'no_on_site_fix',
    recordedAt: checkInAt,
    violation: 'no_checkout',
    messageKey: 'no_check_out_office_confirms',
    leftEarly,
  };
}

// ---------------------------------------------------------------------------
// §5.2b · breaks inside the paid window
// ---------------------------------------------------------------------------

export interface BreakSpan {
  startedAt: Date;
  /** Null while the break is still running: it then ends at the finish. */
  endedAt: Date | null;
}

export interface BreakWindowInput {
  shift: ShiftWindow;
  /** The accepted check-in; null reads as the scheduled start. */
  checkInAt: Date | null;
  /**
   * The finish the pay window uses: the manager-entered finish, the recorded
   * check-out, or — for a shift still running — now.
   */
  finishAt: Date;
}

/**
 * One break's minutes inside the paid window [max(check-in, start),
 * effectiveEnd(finish)] (audit D49): the scheduled end, or — for a finish
 * more than 15 minutes past it — the actual finish (ADR-0184). A break taken
 * before the paid window opened, or after it closed, costs the worker
 * nothing: RULE-01 never paid those minutes in the first place, so deducting
 * them again would take them twice. A break taken during an overrun is
 * inside the paid window and is deducted like any other. Mirrors
 * `break_window_minutes()` in SQL; both are held to the `breaks` vectors.
 */
export function breakWindowMinutes(window: BreakWindowInput, br: BreakSpan): number {
  const { shift, checkInAt, finishAt } = window;
  const from = Math.max(
    br.startedAt.getTime(),
    shift.startsAt.getTime(),
    checkInAt ? checkInAt.getTime() : -Infinity,
  );
  const to = Math.min(
    (br.endedAt ?? finishAt).getTime(),
    finishAt.getTime(),
    effectiveEnd(shift, finishAt).getTime(),
  );
  return Math.max(0, Math.round((to - from) / MS_PER_MIN));
}

/** §5.2b. The unpaid total: every break clipped to the paid window, then summed. */
export function unpaidBreakMinutes(window: BreakWindowInput, breaks: readonly BreakSpan[]): number {
  return breaks.reduce((total, br) => total + breakWindowMinutes(window, br), 0);
}

// ---------------------------------------------------------------------------
// §5.2 · the pay window
// ---------------------------------------------------------------------------

/**
 * RULE-14. A No check-out violation blocks the four-hour floor only while it
 * is unresolved; resolving it means the shift ended to the client's
 * satisfaction, so the floor comes back.
 */
export type NoCheckOutState = 'none' | 'unresolved' | 'resolved';

export interface PayInput {
  shift: ShiftWindow;
  checkInAt: Date;
  /**
   * The recorded check-out: the on-site press, the last on-site fix when
   * pressed off-site, or the finish a manager entered when resolving a No
   * check-out. Null means none of those exist yet.
   */
  checkOutAt: Date | null;
  /** Total unpaid break minutes taken inside the shift (§5.2b). */
  unpaidBreakMin?: number;
  /** A "Left early" violation blocks the floor, resolved or not (RULE-14). */
  leftEarlyViolation?: boolean;
  noCheckOut?: NoCheckOutState;
}

export type PayStatus = 'settled' | 'undetermined';

export interface PayResult {
  status: PayStatus;
  /**
   * Payable minutes after breaks and the floor. Null when undetermined: a
   * shift with no recorded finish has no payable figure at all.
   */
  payableMin: number | null;
  /** Before the four-hour floor, for the check-out screen's "Worked" line. */
  workedMin: number | null;
  /** True when the floor did the work rather than the clock. */
  floorApplied: boolean;
  /**
   * Recorded check-out past the 15-minute mark: "Signed out late" on the
   * monitor (§9.5) for the office to verify with the worker (ADR-0184).
   */
  lateCheckOutFlag: boolean;
  /**
   * ADR-0184. Of `payableMin`, the minutes past the scheduled end: the
   * clock time from the end to the actual finish when the check-out was
   * more than 15 minutes late — at most 4 hours, and 0 for a section that
   * ended before `OVERRUN_PAID_FROM` — else 0. Its own line on the invoice.
   * Unpaid breaks come off the main part first; only if they exceed it
   * (a break during the overrun longer than the rest of the shift) does
   * the remainder come off the overrun, so it never exceeds `workedMin`.
   * Null when undetermined.
   */
  overrunMin: number | null;
}

/**
 * When the paid clock starts: the later of the scheduled start and the actual
 * check-in (ADR-0095). Arriving early never pays early, and arriving late is
 * paid only from the press — the 30-minute grace decides Late vs No-show, not
 * pay.
 */
export function effectiveStart(shift: ShiftWindow, checkInAt: Date): Date {
  return checkInAt > shift.startsAt ? checkInAt : shift.startsAt;
}

/**
 * True when the recorded finish is more than `CHECK_OUT_FLAG_MIN` past the
 * scheduled end: paid to the actual finish and flagged "Signed out late"
 * (ADR-0184).
 */
export function isLateCheckOut(shift: ShiftWindow, checkOutAt: Date): boolean {
  return minutesBetween(shift.endsAt, checkOutAt) > CHECK_OUT_FLAG_MIN;
}

/**
 * ADR-0184's effective date. The paid-to-the-actual-finish rule applies to
 * role sections whose scheduled END is at or after 21 October 2026, 00:00
 * Europe/London (= 2026-10-20T23:00:00Z, BST). Earlier sections keep the
 * rule they were worked under — paid to the scheduled end however late the
 * check-out — so no history is re-priced. SQL repeats this literal in
 * `payable_minutes()` and `break_window_minutes()` (20261022200100).
 */
export const OVERRUN_PAID_FROM = new Date('2026-10-20T23:00:00Z');

/** ADR-0184: the overrun rule applies to this section (its end is on or after the cutoff). */
export function overrunRuleApplies(shift: ShiftWindow): boolean {
  return shift.endsAt.getTime() >= OVERRUN_PAID_FROM.getTime();
}

/**
 * When the paid clock stops (ADR-0184). Before the end, the check-out; from
 * the end to end+15, the scheduled end (the grace pays to the end, not the
 * press); more than 15 minutes past it, the actual recorded finish — but
 * never more than `NO_CHECK_OUT_AFTER_MIN` (4 h) past the end, where RULE-02
 * takes over: THC's rule covers sign-outs "between 16:15 and 20:00", and a
 * finish a manager types later than that (a typo, or a real one) is not
 * paid beyond it. A section that ended before `OVERRUN_PAID_FROM` is paid to
 * its scheduled end, as it was when it was worked.
 */
export function effectiveEnd(shift: ShiftWindow, checkOutAt: Date): Date {
  if (isLateCheckOut(shift, checkOutAt) && overrunRuleApplies(shift)) {
    const cap = addMinutes(shift.endsAt, NO_CHECK_OUT_AFTER_MIN);
    return checkOutAt < cap ? checkOutAt : cap;
  }
  return checkOutAt < shift.endsAt ? checkOutAt : shift.endsAt;
}

export function payableMinutes(input: PayInput): PayResult {
  const { shift, checkInAt, checkOutAt } = input;
  const unpaidBreakMin = input.unpaidBreakMin ?? 0;
  const noCheckOut = input.noCheckOut ?? 'none';

  if (checkOutAt === null) {
    // RULE-02. No silent default to the scheduled finish.
    return {
      status: 'undetermined',
      payableMin: null,
      workedMin: null,
      floorApplied: false,
      lateCheckOutFlag: false,
      overrunMin: null,
    };
  }

  const from = effectiveStart(shift, checkInAt);
  const to = effectiveEnd(shift, checkOutAt);
  const gross = minutesBetween(from, to);

  // RULE-02 from the other direction. A check-out that is not after the
  // check-in, or a check-in past the end of the role section, leaves
  // [check-in, check-out] ∩ [start, end] empty: there is no shift here to
  // pay. Clamping that to zero and then applying the 4-hour floor would
  // invent four hours out of nothing, so it is the same undetermined state
  // as a missing check-out — §9.9 shows "Pending" in place of the payable
  // hours and the CSV export leaves the row out until a manager resolves
  // it. RULE-14's floor is for "a worker who actually checked in and worked
  // the shift"; this worker did not. A check-in at or after the scheduled
  // end is the same empty intersection, even when a late check-out past
  // end+15 would otherwise give it length (ADR-0184).
  if (gross <= 0 || from >= shift.endsAt) {
    return {
      status: 'undetermined',
      payableMin: null,
      workedMin: null,
      floorApplied: false,
      lateCheckOutFlag: false,
      overrunMin: null,
    };
  }

  // Whole minutes, so a timesheet, the app and the payroll export cannot
  // disagree in the seconds (and so TypeScript and SQL round identically).
  const worked = Math.round(Math.max(0, gross - unpaidBreakMin));

  // RULE-14. Left early blocks the floor for good; No check-out blocks it only
  // until a manager resolves it.
  const floorEligible = !input.leftEarlyViolation && noCheckOut !== 'unresolved';
  const payable = floorEligible ? Math.max(worked, MINIMUM_SHIFT_MIN) : worked;

  // ADR-0184. The overrun is the clock time past the scheduled end, whole
  // minutes. Breaks are taken off the main part; the overrun gives way only
  // when they are longer than all of it, so main + overrun = worked.
  // The flag is the clock (§9.5); the overrun is what is paid past the end:
  // the capped paid end, and nothing for a section before the cutoff.
  const late = isLateCheckOut(shift, checkOutAt);
  const overrun =
    to > shift.endsAt ? Math.min(worked, Math.round(minutesBetween(shift.endsAt, to))) : 0;

  return {
    status: 'settled',
    payableMin: payable,
    workedMin: worked,
    floorApplied: floorEligible && payable > worked,
    lateCheckOutFlag: late,
    overrunMin: overrun,
  };
}

/**
 * Holiday pay is always broken out at 12.07% and never blended into the rate
 * (§9.8, §9.9). Returned separately so no caller can accidentally add them —
 * and the worker's own screens only ever read `basePence` (§5.1).
 */
export const HOLIDAY_RATE = 0.1207;

export interface Money {
  basePence: number;
  holidayPence: number;
}

export function pay(payableMin: number, hourlyRatePence: number): Money {
  const basePence = Math.round((payableMin / 60) * hourlyRatePence);
  return { basePence, holidayPence: Math.round(basePence * HOLIDAY_RATE) };
}

/**
 * Which `check_logs` row is the one that counts (§1.5, RULE-01).
 *
 * `check_logs` is append-only and holds one row per button press, not one
 * per booking: a strict-buffer turn-away (RULE-15) and an out-of-radius
 * refusal are both logged, and only the accepted press carries
 * `check_in_at`. So the row a screen must read is the earliest one that
 * actually checked the worker in — never `[0]` of whatever order a
 * response happened to arrive in.
 *
 * This is the same row the SQL takes with
 * `where check_in_at is not null order by check_in_at limit 1`
 * (`payable_shifts_v`, `checkin_monitor_v`, `staff_earnings()`,
 * `check_out()`), and it lives here rather than in either app because two
 * screens read these rows through PostgREST — the worker's on-shift screen
 * and the office's §9.5 violation log — and a JSON array of embedded rows
 * carries no ordering guarantee of its own. Both got it wrong the same
 * way; one definition is what stops the third.
 *
 * `check_out_at` and `manager_finish_at` only ever exist on this row,
 * because `check_out()` and `resolve_violation()` both resolve it with
 * that same lateral before they write.
 */
export function acceptedLog<T extends { check_in_at: string | null }>(
  logs: readonly T[] | null | undefined,
): T | null {
  const stamp = (l: T) => Date.parse(l.check_in_at ?? '');
  const accepted = (logs ?? []).filter((l) => Boolean(l.check_in_at));
  return [...accepted].sort((a, b) => stamp(a) - stamp(b))[0] ?? null;
}

// ---------------------------------------------------------------------------
// §6 · the show-rate (BG-03, RULE-14, §9.5)
// ---------------------------------------------------------------------------

/** One violation on a booking, as far as the show-rate cares. */
export interface ShowRateViolation {
  type: string;
  resolved: boolean;
  /**
   * A No check-out raised for review of a stale on-site fix (audit D15,
   * ADR-0035), `violations.stale_fix_review` in SQL. The worker did press
   * Check out; only the recorded finish waits for a manager, so it never
   * counts against the show-rate.
   */
  staleFixReview?: boolean;
}

/** One booking in a worker's history: its status and the violations on it. */
export interface ShowRateBooking {
  /** `bookings.status` — worked, turned_away, confirmed, cancelled, … */
  status: string;
  violations: readonly ShowRateViolation[];
}

/**
 * The §6 "Show-rate (reliability)" input, 0–100, from a worker's history.
 * Postgres repeats this as `staff_show_rate(uuid)` (20260928110100), which
 * is what `auto_assign_candidates` feeds the 30% show factor; the cases in
 * `pay.vectors.json` → `showRate` are replayed by name in
 * supabase/tests/596_show_rate_derived.sql so the two cannot drift.
 *
 * The reading of the scope (docs/15 Q4):
 *
 *  - The sample is every shift the worker was due at and the day came:
 *    `worked`, `turned_away`, and a booking carrying an unresolved No-show
 *    (which stays `confirmed` in the roster by design, §3.3).
 *  - Worked and turned away both mean they turned up. A strict-buffer
 *    turn-away is paid under RULE-15 and is never a mark against them.
 *  - An unresolved No-show (BG-03) or No check-out (RULE-14) counts
 *    against; resolving lifts it. "Removes or reduces" (§9.5) is read as
 *    REMOVES — the scope gives no half weight anywhere.
 *  - A No check-out raised only to review a stale on-site fix (D15,
 *    ADR-0035) weighs nothing: the worker pressed Check out, and the app's
 *    screen-open pings are what left the fix old, not the worker.
 *  - Late, Left early and Left the geofence weigh nothing: §9.5 says they
 *    are "only ever reviewed by the manager case by case, with no
 *    automatic consequence".
 *  - Self-cancel, Decline and Leaving never enter the sample: those
 *    bookings are cancelled / closed, each promised "no show-rate impact".
 *  - No history is null; the candidates function defaults it to 90, the §6
 *    formula's own zero point, so a new worker scores as before.
 */
export function showRate(bookings: readonly ShowRateBooking[]): number | null {
  const unresolved = (b: ShowRateBooking, type: string) =>
    b.violations.some((v) => v.type === type && !v.resolved && !v.staleFixReview);

  const sample = bookings.filter(
    (b) => b.status === 'worked' || b.status === 'turned_away' || unresolved(b, 'no_show'),
  );
  if (sample.length === 0) return null;

  const shown = sample.filter(
    (b) => !unresolved(b, 'no_show') && !unresolved(b, 'no_checkout'),
  ).length;
  // Two decimals, the same rounding as SQL's round(…, 2).
  return Math.round((shown / sample.length) * 10_000) / 100;
}
