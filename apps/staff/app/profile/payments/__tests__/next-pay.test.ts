import { describe, expect, it } from 'vitest';
import { nextPay } from '../earnings';
import { nextPayLine } from '../../_components/ProfileHub';
import type { EarningsRow } from '../../types';

/**
 * "Next pay Fri 2 Oct · £123.45" on the Profile tab. The pay date is the
 * Friday after the Mon–Sun week worked (pay-date.ts); the amount is BASE
 * pay, as EarningsCard shows it — holiday pay never blended (§9.8).
 */
const row = (payDate: string, basePence: number | null, id = payDate): EarningsRow => ({
  bookingId: `${id}-${basePence}`,
  eventTitle: 'Board Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  roleName: 'Waiting Staff',
  startsAt: new Date('2026-09-22T17:00:00Z'),
  endsAt: new Date('2026-09-22T23:00:00Z'),
  payRate: 14,
  checkInAt: null,
  checkOutAt: null,
  unpaidBreakMin: 0,
  payableMin: basePence === null ? null : 360,
  floorApplied: false,
  payDate,
  basePence,
});

// Friday 25 Sep 2026, 12:00 UK.
const NOW = new Date('2026-09-25T11:00:00Z');

describe('nextPay', () => {
  it('sums every shift paid on the soonest Friday still to come', () => {
    const rows = [
      row('2026-10-02', 8400, 'a'),
      row('2026-10-02', 3945, 'b'),
      row('2026-10-09', 5600),
      row('2026-09-18', 7000), // already paid
    ];
    expect(nextPay(rows, NOW)).toEqual({ payDate: '2026-10-02', totalPence: 12345, count: 2 });
  });

  it('counts today’s Friday as paid, not next', () => {
    expect(nextPay([row('2026-09-25', 5000)], NOW)).toBeNull();
  });

  it('leaves out a shift with no settled figure (no check-out yet)', () => {
    expect(nextPay([row('2026-10-02', null)], NOW)).toBeNull();
    expect(nextPay([row('2026-10-02', null), row('2026-10-09', 100)], NOW)).toMatchObject({
      payDate: '2026-10-09',
      totalPence: 100,
    });
  });

  it('is null when nothing is owed', () => {
    expect(nextPay([], NOW)).toBeNull();
    expect(nextPay([row('2026-10-02', 0)], NOW)).toBeNull();
  });
});

describe('nextPayLine', () => {
  it('reads as the wireframe line, from the base figure only', () => {
    expect(nextPayLine({ payDate: '2026-10-02', totalPence: 12345 })).toBe(
      'Next pay Fri 2 Oct · £123.45',
    );
  });

  it('is absent when nothing is owed', () => {
    expect(nextPayLine(null)).toBeNull();
    expect(nextPayLine({ payDate: '2026-10-02', totalPence: 0 })).toBeNull();
  });
});
