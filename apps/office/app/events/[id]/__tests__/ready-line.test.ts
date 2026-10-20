import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import { readyLine } from '../board-model';

/**
 * §3.5 stage 2 on the board's confirmed rows. Found 19.10.2026: a worker
 * booked on the day (RULE-08) read "I'm ready — not yet", as if the 12:05
 * release could still reach them; it never asks or releases them
 * (readyCutoffApplies).
 */
describe('readyLine', () => {
  const start = ukInstant('2026-10-21', '12:00');

  it('shows the press once made', () => {
    expect(readyLine('2026-10-20T08:40:00Z', '2026-10-18T09:00:00Z', start)).toBe(
      "I'm ready ✓ 09:40",
    );
  });

  it('says not yet for a booking the 12:00 deadline applies to', () => {
    expect(readyLine(null, '2026-10-18T09:00:00Z', start)).toBe("I'm ready — not yet");
  });

  it('says not asked for one confirmed after the deadline', () => {
    expect(readyLine(null, '2026-10-20T11:30:00Z', start)).toBe(
      "I'm ready — not asked (booked after the 12:00 deadline)",
    );
    expect(readyLine(null, '2026-10-21T08:00:00Z', start)).toBe(
      "I'm ready — not asked (booked after the 12:00 deadline)",
    );
  });
});
