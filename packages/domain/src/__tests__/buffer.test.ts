import { describe, expect, it } from 'vitest';
import {
  allocationTarget,
  formatAllocation,
  formatFill,
  isFilled,
  isTurnedAway,
  seatsToOffer,
} from '../buffer';

describe('buffer display (§3.2)', () => {
  it('shows 6 (+1), never 7', () => {
    expect(formatAllocation(6, 1)).toBe('6 (+1)');
    expect(formatAllocation(6, 1)).not.toBe('7');
  });

  it('omits the buffer when there is none', () => {
    expect(formatAllocation(6, 0)).toBe('6');
  });

  it('still seats headcount plus buffer', () => {
    expect(allocationTarget(6, 1)).toBe(7);
  });
});

describe('fill counts (§3.3)', () => {
  const counts = { headcount: 6, buffer: 1, confirmed: 4, invited: 9 };

  it('counts confirmed only, against headcount', () => {
    expect(formatFill(counts)).toBe('4/6');
  });

  it('is not filled by invitations', () => {
    expect(isFilled(counts)).toBe(false);
    expect(isFilled({ ...counts, confirmed: 6 })).toBe(true);
  });

  it('keeps offering up to headcount plus buffer', () => {
    expect(seatsToOffer(counts)).toBe(3);
    expect(seatsToOffer({ ...counts, confirmed: 7 })).toBe(0);
  });
});

describe('strict buffer at check-in (RULE-15)', () => {
  it('turns away everyone after the headcount', () => {
    expect(isTurnedAway(6, 6)).toBe(false);
    expect(isTurnedAway(7, 6)).toBe(true);
  });
});
