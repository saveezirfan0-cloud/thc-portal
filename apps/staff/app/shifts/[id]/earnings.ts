import { payableMinutes } from '@thc/domain';
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

export function shiftEarnings(shift: ShiftDetail, now = new Date()): Earnings | null {
  if (!shift.checkInAt || !shift.checkOutAt) return null;

  const unpaidBreakMin = shift.breaksLogged ? totalBreakMinutes(shift, now) : 0;
  const result = payableMinutes({
    shift: { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
    checkInAt: new Date(shift.checkInAt),
    checkOutAt: new Date(shift.checkOutAt),
    unpaidBreakMin,
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
