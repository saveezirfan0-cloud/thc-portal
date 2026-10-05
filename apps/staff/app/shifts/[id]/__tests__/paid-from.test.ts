import { describe, expect, it } from 'vitest';
import { paidFromIso } from '../ShiftScreen';

const shift = { startsAt: '2026-09-26T08:00:00Z', endsAt: '2026-09-26T16:00:00Z' };
const START = '2026-09-26T08:00:00.000Z';

// RULE-01 / ADR-0087: paid from the later of the scheduled start and the check-in.
describe('paidFromIso', () => {
  it('is the scheduled start before check-in', () => {
    expect(paidFromIso({ ...shift, checkInAt: null })).toBe(shift.startsAt);
  });

  it('is the scheduled start for an early arrival', () => {
    expect(paidFromIso({ ...shift, checkInAt: '2026-09-26T07:51:00Z' })).toBe(START);
  });

  it('is the actual check-in for a late arrival inside the grace', () => {
    expect(paidFromIso({ ...shift, checkInAt: '2026-09-26T08:14:00Z' })).toBe(
      '2026-09-26T08:14:00.000Z',
    );
  });
});
