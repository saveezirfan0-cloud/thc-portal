import { describe, expect, it } from 'vitest';
import { HOLIDAY_RATE, pay, payableMinutes } from '@thc/domain';
import { formatPayDate, isPaid, isoWeekday, payDateFor, payMonth, ukDate } from '../pay-date';
import { basePenceFor, formatMoney, paidShifts, paidThisMonth } from '../earnings';
import type { EarningsRow } from '../../types';

/** A shift ending at a given UK wall-clock instant. */
const at = (iso: string) => new Date(iso);

describe('payDateFor — the Friday after the Mon–Sun week worked', () => {
  it('matches the wireframe’s three earnings cards', () => {
    // wireframes/staff/profile.html: Sat 5 Sep and Wed 2 Sep 2026 both read
    // "Paid Fri 11 Sep"; Sat 29 Aug reads "Paid Fri 4 Sep".
    expect(payDateFor(at('2026-09-05T23:00:00+01:00'))).toBe('2026-09-11');
    expect(payDateFor(at('2026-09-02T23:00:00+01:00'))).toBe('2026-09-11');
    expect(payDateFor(at('2026-08-29T16:00:00+01:00'))).toBe('2026-09-04');
  });

  it('pays a Monday shift eleven days later and a Sunday shift five', () => {
    // Mon 31 Aug 2026 and Sun 6 Sep 2026 are the ends of the same pay week.
    expect(payDateFor(at('2026-08-31T20:00:00+01:00'))).toBe('2026-09-11');
    expect(payDateFor(at('2026-09-06T20:00:00+01:00'))).toBe('2026-09-11');
  });

  it('always lands on a Friday', () => {
    for (let day = 1; day <= 28; day += 1) {
      const iso = `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`;
      expect(isoWeekday(payDateFor(at(iso)))).toBe(5);
    }
  });

  it('uses the UK week, not the UTC one', () => {
    // 00:30 BST on Monday 7 Sep is 23:30 UTC on Sunday 6 Sep. The shift
    // belongs to the week that Monday starts — a week later in pay terms.
    const ukMonday = at('2026-09-07T00:30:00+01:00');
    expect(ukDate(ukMonday)).toBe('2026-09-07');
    expect(payDateFor(ukMonday)).toBe('2026-09-18');
  });

  it('crosses a year end without drifting', () => {
    // Thu 31 Dec 2026 falls in the Mon 28 Dec – Sun 3 Jan week.
    expect(payDateFor(at('2026-12-31T22:00:00Z'))).toBe('2027-01-08');
  });
});

describe('isPaid — what Earnings history is allowed to show', () => {
  it('shows a shift only once its Friday has arrived', () => {
    expect(isPaid('2026-09-11', at('2026-09-10T23:59:00+01:00'))).toBe(false);
    expect(isPaid('2026-09-11', at('2026-09-11T00:01:00+01:00'))).toBe(true);
  });
});

describe('formatting', () => {
  it('prints the pay date the way the card does', () => {
    // "Sep", as the wireframe writes it, in every engine. Intl's own
    // short month is "Sept" in Node and Chrome but "Sep" in Safari, so the
    // server's render and an iPhone's disagreed — a hydration mismatch. The
    // words now come from `formatDateIn` in @thc/domain, which
    // `formatDateTimeIn` uses too, so September has one spelling app-wide.
    expect(formatPayDate('2026-09-11')).toBe('Fri 11 Sep');
    expect(formatPayDate('2026-09-04')).toBe('Fri 4 Sep');
  });

  it('groups by the month the money arrives in', () => {
    expect(payMonth('2026-09-11')).toBe('2026-09');
  });

  it('prints pence as pounds', () => {
    expect(formatMoney(11200)).toBe('£112.00');
  });
});

/**
 * A worked shift, as `staff_earnings()` would return it, run through the
 * same `payableMinutes()` the screen uses.
 */
function row(over: Partial<EarningsRow> & { startsAt: Date; endsAt: Date }): EarningsRow {
  const checkInAt = over.checkInAt ?? over.startsAt;
  const checkOutAt = over.checkOutAt ?? over.endsAt;
  const unpaidBreakMin = over.unpaidBreakMin ?? 0;
  const settled = payableMinutes({
    shift: { startsAt: over.startsAt, endsAt: over.endsAt },
    checkInAt,
    checkOutAt,
    unpaidBreakMin,
  });
  const payRate = over.payRate ?? 14;
  return {
    bookingId: over.bookingId ?? 'b1',
    eventTitle: 'Board Dinner',
    venueName: 'Leonardo Royal Hotel',
    venueAddress: '10 Godliman St, EC4V 5AJ',
    roleName: 'Waiting Staff',
    payRate,
    checkInAt,
    checkOutAt,
    unpaidBreakMin,
    payableMin: settled.payableMin,
    floorApplied: settled.floorApplied,
    payDate: payDateFor(over.endsAt),
    basePence: settled.payableMin === null ? null : basePenceFor(settled.payableMin, payRate),
    ...over,
  };
}

describe('earnings agree with the domain function', () => {
  it('an eight-hour shift at £14.00 is £112.00', () => {
    const card = row({
      startsAt: at('2026-09-05T15:00:00+01:00'),
      endsAt: at('2026-09-05T23:00:00+01:00'),
      payRate: 14,
    });
    expect(card.payableMin).toBe(480);
    expect(formatMoney(card.basePence ?? 0)).toBe('£112.00');
  });

  it('a five-hour shift at £15.50 is £77.50', () => {
    const card = row({
      startsAt: at('2026-09-02T18:00:00+01:00'),
      endsAt: at('2026-09-02T23:00:00+01:00'),
      payRate: 15.5,
    });
    expect(formatMoney(card.basePence ?? 0)).toBe('£77.50');
  });

  it('RULE-14’s four-hour floor is visible, and it is the domain’s floor', () => {
    const card = row({
      startsAt: at('2026-08-29T12:00:00+01:00'),
      endsAt: at('2026-08-29T16:00:00+01:00'),
      checkOutAt: at('2026-08-29T14:30:00+01:00'),
      payRate: 14,
    });
    expect(card.floorApplied).toBe(true);
    expect(card.payableMin).toBe(240);
    expect(formatMoney(card.basePence ?? 0)).toBe('£56.00');
  });

  it('deducts unpaid breaks', () => {
    const card = row({
      startsAt: at('2026-09-05T15:00:00+01:00'),
      endsAt: at('2026-09-05T23:00:00+01:00'),
      unpaidBreakMin: 30,
      payRate: 14,
    });
    expect(card.payableMin).toBe(450);
    expect(formatMoney(card.basePence ?? 0)).toBe('£105.00');
  });

  it('never shows the worker anything but base pay (§9.8)', () => {
    const card = row({
      startsAt: at('2026-09-05T15:00:00+01:00'),
      endsAt: at('2026-09-05T23:00:00+01:00'),
      payRate: 14,
    });
    const money = pay(card.payableMin ?? 0, 1400);
    // The holiday element exists, is 12.07%, and is not on the row.
    expect(money.holidayPence).toBe(Math.round(money.basePence * HOLIDAY_RATE));
    expect(Object.keys(card)).not.toContain('holidayPence');
    expect(Object.keys(card)).not.toContain('chargeRate');
    expect(card.basePence).toBe(money.basePence);
  });
});

describe('the Earnings history list', () => {
  const worked = row({
    startsAt: at('2026-09-05T15:00:00+01:00'),
    endsAt: at('2026-09-05T23:00:00+01:00'),
    payRate: 14,
  });
  const alsoWorked = row({
    bookingId: 'b2',
    startsAt: at('2026-09-02T18:00:00+01:00'),
    endsAt: at('2026-09-02T23:00:00+01:00'),
    payRate: 15.5,
  });

  it('hides a shift that has been worked but not yet paid', () => {
    expect(paidShifts([worked], at('2026-09-08T09:00:00+01:00'))).toEqual([]);
    expect(paidShifts([worked], at('2026-09-11T09:00:00+01:00'))).toHaveLength(1);
  });

  it('is newest first', () => {
    const list = paidShifts([alsoWorked, worked], at('2026-09-30T09:00:00+01:00'));
    expect(list.map((card) => card.bookingId)).toEqual(['b1', 'b2']);
  });

  it('totals by the month the money arrives in, not the month worked', () => {
    // Both shifts are paid on Fri 11 Sep, so both count towards September.
    const total = paidThisMonth([worked, alsoWorked], at('2026-09-30T09:00:00+01:00'));
    expect(total.month).toBe('2026-09');
    expect(total.count).toBe(2);
    expect(formatMoney(total.totalPence)).toBe('£189.50');
  });

  it('counts nothing in a month before its pay date', () => {
    const augustShift = row({
      bookingId: 'b3',
      startsAt: at('2026-08-29T12:00:00+01:00'),
      endsAt: at('2026-08-29T16:00:00+01:00'),
      payRate: 14,
    });
    // Worked in August, paid on Fri 4 September.
    expect(augustShift.payDate).toBe('2026-09-04');
    expect(paidThisMonth([augustShift], at('2026-08-31T09:00:00+01:00')).count).toBe(0);
  });
});
