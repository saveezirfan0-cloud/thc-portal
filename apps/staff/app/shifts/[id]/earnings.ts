import { effectiveEnd, effectiveStart, payableMinutes } from '@thc/domain';
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
  /** RULE-01: the paid window, for the "Worked" row — never the scheduled one blindly. */
  paidFrom: Date;
  paidTo: Date;
}

export function shiftEarnings(shift: ShiftDetail, now = new Date()): Earnings | null {
  if (!shift.checkInAt || !shift.checkOutAt) return null;

  const window = { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) };
  const checkInAt = new Date(shift.checkInAt);
  const checkOutAt = new Date(shift.checkOutAt);
  const unpaidBreakMin = shift.breaksLogged ? totalBreakMinutes(shift, now) : 0;
  // RULE-14: a Left-early violation blocks the floor, resolved or not; a No
  // check-out one only while unresolved. The same inputs `check_out()` and
  // `payable_shifts_v` give the SQL twin, so this screen cannot show a
  // floored four hours the payroll export will not pay.
  const result = payableMinutes({
    shift: window,
    checkInAt,
    checkOutAt,
    unpaidBreakMin,
    leftEarlyViolation: shift.leftEarly,
    noCheckOut: shift.noCheckOut,
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
    paidFrom: effectiveStart(window, checkInAt),
    paidTo: effectiveEnd(window, checkOutAt),
  };
}

/**
 * The on-shift counter, in seconds (§5.1 wireframe (d): "02:14:36" at
 * 19:14 for a 16:52 check-in — "paid from 17:00 (RULE-01)").
 *
 * The chargeable clock starts at the PAID start, not the press: arriving
 * early never pays early, and a check-in inside the grace is paid from the
 * scheduled start. Unpaid breaks come off as they run. It keeps running past
 * the scheduled end — the sub-line says "paid up to 23:30" — because what
 * the worker is watching is the shift they are on, not the pay window.
 */
export function chargeableSeconds(shift: ShiftDetail, now = new Date()): number {
  if (!shift.checkInAt) return 0;
  const window = { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) };
  const from = effectiveStart(window, new Date(shift.checkInAt));
  const elapsed = Math.floor((now.getTime() - from.getTime()) / 1000);
  const breaks = shift.breaksLogged ? totalBreakSeconds(shift, now) : 0;
  return Math.max(0, elapsed - breaks);
}

/** The running break, in seconds, for the "Break · running" counter (§5.2b). */
export function openBreakSeconds(shift: ShiftDetail, now = new Date()): number {
  const open = shift.breaks.find((b) => b.endedAt === null);
  if (!open) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(open.startedAt).getTime()) / 1000));
}

function totalBreakSeconds(shift: ShiftDetail, now: Date): number {
  return shift.breaks.reduce((total, br) => {
    const end = br.endedAt ? new Date(br.endedAt) : now;
    return (
      total + Math.max(0, Math.floor((end.getTime() - new Date(br.startedAt).getTime()) / 1000))
    );
  }, 0);
}

/** "02:14:36" — the wireframe's counter, ticking by the second. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(sec)}`;
}

/** Minutes of one finished break, for "19:31 – 19:51 · 20 min". */
export function breakMinutes(startedAt: string, endedAt: string): number {
  return Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );
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
