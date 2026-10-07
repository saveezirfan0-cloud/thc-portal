import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PASSES,
  PASS_IN_FLIGHT_SECONDS,
  inFlightSince,
  maxPasses,
  passIsBusy,
} from '../concurrency';

describe('how many runner passes may overlap', () => {
  it('defaults to two, and takes 1–6 from RTW_CHECK_MAX_PASSES', () => {
    expect(maxPasses(undefined)).toBe(DEFAULT_MAX_PASSES);
    expect(maxPasses('')).toBe(DEFAULT_MAX_PASSES);
    expect(maxPasses('1')).toBe(1);
    expect(maxPasses('6')).toBe(6);
    expect(maxPasses('0')).toBe(DEFAULT_MAX_PASSES);
    expect(maxPasses('7')).toBe(DEFAULT_MAX_PASSES);
    expect(maxPasses('2.5')).toBe(DEFAULT_MAX_PASSES);
    expect(maxPasses('lots')).toBe(DEFAULT_MAX_PASSES);
  });

  it('stands down at the cap, and fails open when the count is unknown', () => {
    expect(passIsBusy(0, 2)).toBe(false);
    expect(passIsBusy(1, 2)).toBe(false);
    expect(passIsBusy(2, 2)).toBe(true);
    expect(passIsBusy(5, 2)).toBe(true);
    // A failed read must never stop the runner.
    expect(passIsBusy(null, 2)).toBe(false);
    expect(passIsBusy(undefined, 2)).toBe(false);
  });

  it('counts a pass as in flight for a little longer than the route may run', () => {
    expect(PASS_IN_FLIGHT_SECONDS).toBeGreaterThan(300);
    const now = new Date('2026-10-07T10:00:00.000Z');
    expect(inFlightSince(now)).toBe('2026-10-07T09:54:00.000Z');
  });
});
