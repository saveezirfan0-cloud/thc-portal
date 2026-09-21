import { describe, expect, it } from 'vitest';
import vectors from '../cap.vectors.json' with { type: 'json' };
import { remainingHours, weeklyCap } from '../cap';
import type { CapInput } from '../cap';

describe('weekly cap (RULE-20)', () => {
  it.each(vectors.cases)('$name', ({ input, expect: expected }) => {
    expect(weeklyCap(input as CapInput)).toEqual({
      capHours: expected.capHours,
      band: expected.band,
    });
  });

  it('never reports negative remaining hours', () => {
    expect(remainingHours({ capHours: 20, band: 'student_term_20' }, 26)).toBe(0);
  });

  it('reports no ceiling as null, not Infinity', () => {
    expect(remainingHours({ capHours: null, band: 'uncapped' }, 60)).toBeNull();
  });
});
