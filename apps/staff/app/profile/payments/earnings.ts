import { pay } from '@thc/domain';
import type { EarningsRow } from '../types';
import { isPaid, payMonth, ukDate } from './pay-date';

/**
 * Earnings history, §10.1's Payment information tab 1.
 *
 * One rule, stated once: the worker sees the BASE figure. §9.8 — "holiday
 * +12.07% is always broken out, never blended" — and §5.1 says the same for
 * the worker's own screens. `pay()` returns both halves precisely so that
 * nobody adds them by accident; this module reads `basePence` and there is
 * no field on `EarningsRow` for the other one.
 *
 * The charge rate never enters the app at all: `staff_earnings()` does not
 * select it.
 */

/** The cards a worker has actually been paid for, newest first. */
export function paidShifts(rows: readonly EarningsRow[], now: Date = new Date()): EarningsRow[] {
  return rows
    .filter((row) => row.basePence !== null && isPaid(row.payDate, now))
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
}

/**
 * The "Paid so far · Sep 2026" tile: everything whose PAY date falls in the
 * current UK month, not everything worked in it. The two differ every
 * month, and the tile is about money in the bank.
 */
export function paidThisMonth(
  rows: readonly EarningsRow[],
  now: Date = new Date(),
): { month: string; totalPence: number; count: number } {
  const month = payMonth(ukDate(now));
  const inMonth = paidShifts(rows, now).filter((row) => payMonth(row.payDate) === month);
  return {
    month,
    totalPence: inMonth.reduce((sum, row) => sum + (row.basePence ?? 0), 0),
    count: inMonth.length,
  };
}

/** Base pence for one shift. Exported so the tests can assert the split. */
export function basePenceFor(payableMin: number, payRate: number): number {
  return pay(payableMin, Math.round(payRate * 100)).basePence;
}

export function formatMoney(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/** "8 h", "5 h 30 m" — the duration line on a card. */
export function formatWorked(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
