/**
 * Pay maths — Scope §5.2, RULE-01 / 02 / 14 / 15.
 *
 * Pure functions over minutes. The SQL view `payable_shifts_v` implements the
 * same maths for reports, and both are held to `pay.vectors.json`.
 *
 * The four rules, in the scope's own terms:
 *
 *  RULE-01 pay window. Payable time is the intersection of the worker's
 *    [check-in, check-out] with the scheduled [start, end]. Arriving early is
 *    not paid. Leaving early is deducted. Two graces, and they are NOT
 *    symmetric in effect:
 *      - Check-in inside the 30-minute grace is paid FROM THE SCHEDULED
 *        START, not from the actual press.
 *      - Check-in after the grace (a No-show reclassified to Late via "Get
 *        back", or a manager-registered arrival) is paid from the ACTUAL time.
 *      - Check-out after the scheduled end is always paid only to the end,
 *        whether it is 1 minute or 3 hours late. The 15-minute mark changes
 *        nothing about the money; past it the monitor raises a flag so a
 *        manager can verify.
 *
 *  RULE-02 no check-out. Four hours after the scheduled end with no check-out,
 *    the button locks and a violation is raised. The payable time is
 *    UNDETERMINED. It never silently defaults to the scheduled finish. It
 *    settles only when a manager resolves the violation by entering the actual
 *    finish time.
 *
 *  RULE-14 four-hour minimum. A floor on the payable time, removed by a "Left
 *    early" violation or by an unresolved "No check-out". Resolving the
 *    latter restores the floor.
 *
 *  RULE-15 buffer turn-away. Past the headcount, a worker is turned away: a
 *    fixed four hours if their logged attempt was on time, nothing if it was
 *    late. It is the attempt timestamp that decides, not a check-in.
 */

/** §5.1. Arriving within this many minutes of the start is Late, not a No-show. */
export const CHECK_IN_GRACE_MIN = 30;

/** §5.2. Past this, a late check-out is flagged on the monitor. Pay is unaffected. */
export const CHECK_OUT_FLAG_MIN = 15;

/** §5.2. At this point past the end, RULE-02 takes over. */
export const NO_CHECK_OUT_AFTER_MIN = 4 * 60;

/** RULE-14. The floor, in minutes. */
export const MINIMUM_SHIFT_MIN = 4 * 60;

export interface ShiftWindow {
  /** Scheduled start of the ROLE SECTION, never the event window (RULE-18). */
  startsAt: Date;
  endsAt: Date;
}

export interface PayInput {
  shift: ShiftWindow;
  checkInAt: Date;
  /**
   * The recorded check-out, the last on-site fix when pressed off-site, or the
   * finish a manager entered when resolving a No check-out. Null means no
   * check-out has happened and none has been supplied.
   */
  checkOutAt: Date | null;
  /** Total unpaid break minutes taken inside the shift (§5.2b). */
  unpaidBreakMin?: number;
  /** A "Left early" violation removes the four-hour floor (RULE-14). */
  leftEarlyViolation?: boolean;
}

export type PayStatus = 'settled' | 'undetermined';

export interface PayResult {
  status: PayStatus;
  /**
   * Payable minutes after breaks and the floor. Null when undetermined: a
   * shift with an unresolved No check-out has no payable figure at all.
   */
  payableMin: number | null;
  /** Before the four-hour floor was applied, for the check-out screen. */
  workedMin: number | null;
  /** True when the floor did the work rather than the clock. */
  floorApplied: boolean;
  /** Late check-out past the 15-minute mark. Money is unchanged; the monitor flags it. */
  lateCheckOutFlag: boolean;
}

const MS_PER_MIN = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_MIN;
}

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MS_PER_MIN);
}

/**
 * When the paid clock starts. Inside the check-in grace the worker is paid
 * from the scheduled start; past it, from when they actually arrived. Arriving
 * early never pays early.
 */
export function effectiveStart(shift: ShiftWindow, checkInAt: Date): Date {
  if (checkInAt <= shift.startsAt) return shift.startsAt;
  const graceEnds = addMinutes(shift.startsAt, CHECK_IN_GRACE_MIN);
  return checkInAt <= graceEnds ? shift.startsAt : checkInAt;
}

/** When the paid clock stops. Never past the scheduled end, however late the press. */
export function effectiveEnd(shift: ShiftWindow, checkOutAt: Date): Date {
  return checkOutAt < shift.endsAt ? checkOutAt : shift.endsAt;
}

/** True once the shift is old enough that a missing check-out is RULE-02, not lateness. */
export function isNoCheckOut(shift: ShiftWindow, now: Date): boolean {
  return now >= addMinutes(shift.endsAt, NO_CHECK_OUT_AFTER_MIN);
}

export function payableMinutes(input: PayInput): PayResult {
  const { shift, checkInAt, checkOutAt } = input;
  const unpaidBreakMin = input.unpaidBreakMin ?? 0;

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

  const gross = Math.max(0, minutesBetween(from, to));
  const worked = Math.max(0, gross - unpaidBreakMin);

  // RULE-14. The floor is removed by a Left-early violation.
  const floorEligible = !input.leftEarlyViolation;
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
 * RULE-15. A worker turned away because the headcount was already met.
 * On time, measured by their logged attempt, means a fixed four hours
 * regardless of how long the shift was. Late means nothing.
 */
export function turnedAwayMinutes(shift: ShiftWindow, attemptAt: Date): number {
  const graceEnds = addMinutes(shift.startsAt, CHECK_IN_GRACE_MIN);
  return attemptAt <= graceEnds ? MINIMUM_SHIFT_MIN : 0;
}

/**
 * Holiday pay is always broken out at 12.07% and never blended into the rate
 * (§9.8, §9.9). Returned separately so no caller can accidentally add them.
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
