import { LEFT_EARLY_GRACE_MIN, payableMinutes, unpaidBreakMinutes } from '@thc/domain';
import type { ShiftDetail } from './types';

/**
 * The check-out confirmation (§5.1).
 *
 * "The screen shows the shift duration, hourly rate, and total earnings —
 * with emphasis on the total earnings figure. Holiday pay is excluded and
 * not shown here", which is §9.8's rule stated for this screen: the worker
 * only ever sees the base rate. So this returns base pence and there is no
 * field for the +12.07% to be rendered into by accident.
 */
export interface Earnings {
  workedMin: number;
  unpaidBreakMin: number;
  payableMin: number;
  hourlyRatePence: number;
  totalPence: number;
  /** RULE-14 lifted it; worth telling the worker why the number is bigger. */
  floorApplied: boolean;
}

/**
 * The same inputs `payable_shifts_v` hands `payable_minutes()` (audit D8):
 * the unpaid breaks clipped to the paid window, and RULE-14's two blockers
 * on the four-hour floor. Without them this screen promised four hours to
 * a worker the payroll then paid one — a Left early violation blocks the
 * floor, resolved or not, and an open No check-out blocks it until a
 * manager resolves it.
 */
export function shiftEarnings(shift: ShiftDetail, now = new Date()): Earnings | null {
  if (!shift.checkInAt || !shift.checkOutAt) return null;

  const unpaidBreakMin = shift.breaksLogged ? paidBreakMinutes(shift, now) : 0;
  const result = payableMinutes({
    shift: { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
    checkInAt: new Date(shift.checkInAt),
    checkOutAt: new Date(shift.checkOutAt),
    unpaidBreakMin,
    leftEarlyViolation: leftEarly(shift),
    noCheckOut: shift.noCheckoutOpen ? 'unresolved' : 'none',
  });
  if (result.payableMin === null || result.workedMin === null) return null;

  const hourlyRatePence = Math.round(shift.payRate * 100);
  return {
    workedMin: result.workedMin,
    unpaidBreakMin,
    payableMin: result.payableMin,
    hourlyRatePence,
    totalPence: Math.round((result.payableMin / 60) * hourlyRatePence),
    floorApplied: result.floorApplied,
  };
}

/**
 * RULE-14's Left early. The server says so when it can (`leftEarly`, from
 * the violations); until `staff_shift_detail()` carries it, the screen reads
 * it the way `check_out()` raises it for an on-site press — a finish more
 * than 15 minutes before the scheduled end (ADR-0032). That errs towards
 * the smaller figure: the screen never promises money payroll won't pay.
 */
export function leftEarly(shift: ShiftDetail): boolean {
  if (typeof shift.leftEarly === 'boolean') return shift.leftEarly;
  if (!shift.checkOutAt) return false;
  return (
    new Date(shift.checkOutAt).getTime() <
    new Date(shift.endsAt).getTime() - LEFT_EARLY_GRACE_MIN * 60_000
  );
}

/**
 * The unpaid break minutes the PAY deducts (§5.2b, D49): each break clipped
 * to [max(check-in, start), min(finish, end)], exactly as
 * `unpaid_break_minutes()` does. A break outside the paid window was never
 * paid, so it is not taken off again.
 */
export function paidBreakMinutes(shift: ShiftDetail, now = new Date()): number {
  return unpaidBreakMinutes(
    {
      shift: { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
      checkInAt: shift.checkInAt ? new Date(shift.checkInAt) : null,
      finishAt: shift.checkOutAt ? new Date(shift.checkOutAt) : now,
    },
    shift.breaks.map((br) => ({
      startedAt: new Date(br.startedAt),
      endedAt: br.endedAt ? new Date(br.endedAt) : null,
    })),
  );
}

/**
 * The live chargeable timer's break total (§5.2b "the chargeable timer is
 * paused"): every break, unclipped, so the timer stops while a break runs
 * whenever it runs. The money is `paidBreakMinutes`.
 *
 * A break still running counts to now, so the on-shift screen's chargeable
 * timer keeps moving in the right direction while the worker is away. The
 * settled figure comes from `unpaid_break_minutes` in the database when the
 * shift closes; this is the same arithmetic for the live view.
 */
export function totalBreakMinutes(shift: ShiftDetail, now = new Date()): number {
  return shift.breaks.reduce((total, br) => {
    const end = br.endedAt
      ? new Date(br.endedAt)
      : shift.checkOutAt
        ? new Date(shift.checkOutAt)
        : now;
    return total + Math.round((end.getTime() - new Date(br.startedAt).getTime()) / 60_000);
  }, 0);
}

export function formatMoney(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
