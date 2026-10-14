import { describe, expect, it } from 'vitest';
import { HOLIDAY_RATE } from '@thc/domain';
import {
  finalPence,
  formatAddition,
  formatPounds,
  holidayPence,
  formatSignedPounds,
  parseRate,
  payRateProblem,
  poundsInput,
  toPence,
} from '../money';

/**
 * §9.8: the holiday element is calculated at 12.07%, shown broken out, and
 * the final rate is what every margin in the system is computed from. These
 * are the wireframe's own figures, and `supabase/tests/150_roles_directory.sql`
 * asserts the same ones against `final_rate()` in SQL — if the two ever
 * disagree, every margin on every screen moves.
 */
describe('the holiday element', () => {
  it('is 12.07%, from one constant', () => {
    expect(HOLIDAY_RATE).toBe(0.1207);
  });

  it.each([
    [1400, 169, 1569],
    [1450, 175, 1625],
    [1550, 187, 1737],
    [1900, 229, 2129],
    [1350, 163, 1513],
    [1600, 193, 1793],
    [1800, 217, 2017],
  ])('%i base → +%i holiday → %i final', (base, holiday, final) => {
    expect(holidayPence(base)).toBe(holiday);
    expect(finalPence(base)).toBe(final);
  });

  it('adds up at every penny from £0 to £500', () => {
    // The three columns of §9.8's table sit next to each other, so they have
    // to add up in front of the manager at any rate, not only at the ones
    // the wireframe happens to print.
    //
    // Checked in plain code and asserted once: 50,001 separate expect() calls
    // took over five seconds on a loaded CI runner and timed the test out.
    const wrong: number[] = [];
    for (let base = 0; base <= 50_000; base += 1) {
      if (finalPence(base) !== base + holidayPence(base)) wrong.push(base);
    }
    expect(wrong).toEqual([]);
  });

  it('is zero on a zero rate rather than a penny', () => {
    expect(holidayPence(0)).toBe(0);
    expect(finalPence(0)).toBe(0);
  });
});

describe('reading the rate field', () => {
  it('takes what a manager would reasonably type', () => {
    expect(parseRate('14')).toBe(1400);
    expect(parseRate('14.5')).toBe(1450);
    expect(parseRate('14.50')).toBe(1450);
    expect(parseRate(' £14.50 ')).toBe(1450);
    expect(parseRate('1,450.00')).toBe(145_000);
    expect(parseRate('0')).toBe(0);
  });

  it('refuses a third decimal rather than rounding a rate silently', () => {
    // numeric(8,2) would round it; the manager would never be told their
    // £14.005 became £14.01. The database rejects it for the same reason.
    expect(parseRate('14.005')).toBeNull();
  });

  it('refuses what is not a rate', () => {
    for (const bad of ['', '   ', 'fourteen', '-1', '1.2.3', '£', '1e3', 'NaN', '14.']) {
      expect(parseRate(bad)).toBeNull();
    }
  });
});

describe('the formats the wireframe prints', () => {
  it('prints money to the penny with the sign', () => {
    expect(formatPounds(1400)).toBe('£14.00');
    expect(formatPounds(1569)).toBe('£15.69');
    expect(formatAddition(169)).toBe('+£1.69');
    expect(poundsInput(1450)).toBe('14.50');
  });

  it('round-trips a rate from the database and back', () => {
    for (const pounds of [0, 13.5, 14, 14.5, 18, 19, 145.55]) {
      expect(parseRate(poundsInput(toPence(pounds)))).toBe(toPence(pounds));
    }
  });
});

describe('the National Living Wage floor and the ceiling (release audit D-M7)', () => {
  const FLOOR = 1271;

  it('refuses a base rate below the floor, and says what the floor is', () => {
    expect(payRateProblem('0.00', FLOOR)).toBe(
      'A pay rate cannot be below the National Living Wage, £12.71/h.',
    );
    expect(payRateProblem('5', FLOOR)).toMatch(/National Living Wage, £12.71/);
    expect(payRateProblem('12.70', FLOOR)).toMatch(/National Living Wage/);
    expect(payRateProblem('12.71', FLOOR)).toBeNull();
  });

  it('lets an unchanged rate under an older floor be saved as it is', () => {
    expect(payRateProblem('11.44', FLOOR, 1144)).toBeNull();
    expect(payRateProblem('11.45', FLOOR, 1144)).toMatch(/National Living Wage/);
  });

  it('answers 999999 with the ceiling, not "not a rate"', () => {
    expect(payRateProblem('999999', FLOOR)).toBe(
      'A pay rate over £1,000.00 an hour is refused — check the figure.',
    );
    expect(payRateProblem('1000.00', FLOOR)).toBeNull();
  });

  it('keeps the format messages', () => {
    expect(payRateProblem('14.005', FLOOR)).toBe('Enter a rate to the penny, e.g. 13.50.');
    expect(payRateProblem('fourteen', FLOOR)).toBe('Enter a rate in pounds and pence, e.g. 13.50.');
  });

  it('signs a margin with a real minus sign', () => {
    expect(formatSignedPounds(-569)).toBe('−£5.69');
    expect(formatSignedPounds(120)).toBe('+£1.20');
  });
});
