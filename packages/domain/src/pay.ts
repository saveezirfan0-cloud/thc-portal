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
 *    check-out] with the scheduled [start, end]. The two graces are not
 *    symmetric in effect:
 *      - check-in inside the 30-minute grace is paid FROM THE SCHEDULED START;
 *      - check-in past it is paid from the ACTUAL time;
 *      - check-out after the end is paid only to the end, whether it is one
 *        minute or three hours late. The 15-minute mark changes no money; past
 *        it the monitor turns the pill red so a manager can verify (§9.5).
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

/** §5.2. Past this, a late check-out is flagged on the monitor. Pay is unaffected. */
export const CHECK_OUT_FLAG_MIN = 15;

/** §5.2. At this point past the end, RULE-02 takes over. */
export const NO_CHECK_OUT_AFTER_MIN = 4 * 60;

/** RULE-14 and RULE-15. The floor, and the flat turn-away payment, in minutes. */
export const MINIMUM_SHIFT_MIN = 4 * 60;

/**
 * §9.5 "Left early" (audit D5, ADR-0032). A check-out pressed more than this
 * long before the scheduled end is an early finish and raises the violation
 * that blocks RULE-14's floor. Inside it, the minutes are still deducted by
 * RULE-01 — only the flag waits, mirroring the 15-minute check-out grace.
 */
export const LEFT_EARLY_GRACE_MIN = 15;

/**
 * RULE-02 review of a stale fix (audit D15, ADR-0032). Off site, a last
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
  return attemptAt < graceEnds ? MINIMUM_SHIFT_MIN : 0;
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
 * One break's minutes inside [max(check-in, start), min(finish, end)]
 * (audit D49). A break taken before the paid window opened, or after it
 * closed, costs the worker nothing: RULE-01 never paid those minutes in the
 * first place, so deducting them again would take them twice. Mirrors
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
    shift.endsAt.getTime(),
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
  /** Recorded check-out past the 15-minute mark: a red pill on the monitor (§9.5). */
  lateCheckOutFlag: boolean;
}

/**
 * When the paid clock starts. Inside the check-in grace the worker is paid
 * from the scheduled start; past it, from when they actually arrived. Arriving
 * early never pays early.
 */
export function effectiveStart(shift: ShiftWindow, checkInAt: Date): Date {
  if (checkInAt <= shift.startsAt) return shift.startsAt;
  const graceEnds = addMinutes(shift.startsAt, CHECK_IN_GRACE_MIN);
  return checkInAt < graceEnds ? shift.startsAt : checkInAt;
}

/** When the paid clock stops. Never past the scheduled end, however late the press. */
export function effectiveEnd(shift: ShiftWindow, checkOutAt: Date): Date {
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
  // the shift"; this worker did not.
  if (gross <= 0) {
    return {
      status: 'undetermined',
      payableMin: null,
      workedMin: null,
      floorApplied: false,
      lateCheckOutFlag: false,
    };
  }

  // Whole minutes, so a timesheet, the app and the payroll export cannot
  // disagree in the seconds (and so TypeScript and SQL round identically).
  const worked = Math.round(Math.max(0, gross - unpaidBreakMin));

  // RULE-14. Left early blocks the floor for good; No check-out blocks it only
  // until a manager resolves it.
  const floorEligible = !input.leftEarlyViolation && noCheckOut !== 'unresolved';
  const payable = floorEligible ? Math.max(worked, MINIMUM_SHIFT_MIN) : worked;

  return {
    status: 'settled',
    payableMin: payable,
    workedMin: worked,
    floorApplied: floorEligible && payable > worked,
    lateCheckOutFlag: minutesBetween(shift.endsAt, checkOutAt) > CHECK_OUT_FLAG_MIN,
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
