import { describe, expect, it } from 'vitest';
import { HOLIDAY_RATE } from '@thc/domain';
import {
  finalPence,
  formatAddition,
  formatPounds,
  holidayPence,
  parseRate,
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
    // The comparison is a plain loop and the assertion runs once, rather
    // than 50,001 expect() calls. Same coverage, and it matters twice over:
    // building that many assertion contexts took the test past vitest's
    // 5-second default on a loaded CI runner while passing on a developer's
    // machine, so it failed by where it ran rather than by what it checked.
    // A mismatch now also names the rate it happened at, which an expect()
    // inside the loop did not.
    const wrong: string[] = [];
    for (let base = 0; base <= 50_000; base += 1) {
      const sum = base + holidayPence(base);
      if (finalPence(base) !== sum) {
        wrong.push(`${base}p: final ${finalPence(base)} ≠ base + holiday ${sum}`);
        if (wrong.length === 5) break;
      }
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
