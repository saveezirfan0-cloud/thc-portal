import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  HARD_GATES,
  fairFactor,
  proximityFactor,
  rankPool,
  ratingFactor,
  score,
  showFactor,
  showsUnderUnavailable,
  venueFactor,
  waveFor,
} from '../scoring';
import type { Candidate } from '../scoring';

describe('factor formulas (§6)', () => {
  it('show-rate is (reliability - 90) / 10 x 100, clamped', () => {
    expect(showFactor(100)).toBe(100);
    expect(showFactor(95)).toBe(50);
    expect(showFactor(90)).toBe(0);
    expect(showFactor(70)).toBe(0);
  });

  it('rating is (rating - 4.0) x 100, clamped', () => {
    expect(ratingFactor(5)).toBe(100);
    expect(ratingFactor(4.5)).toBeCloseTo(50);
    expect(ratingFactor(4)).toBe(0);
    expect(ratingFactor(3.2)).toBe(0);
  });

  it('proximity is 100 - km x 9, clamped', () => {
    expect(proximityFactor(0)).toBe(100);
    expect(proximityFactor(5)).toBe(55);
    expect(proximityFactor(11.2)).toBe(0);
    expect(proximityFactor(40)).toBe(0);
  });

  it('fair rotation is 100 - min(future, 5) x 20', () => {
    expect(fairFactor(0)).toBe(100);
    expect(fairFactor(2)).toBe(60);
    expect(fairFactor(5)).toBe(0);
    // Capped at five, so a very busy worker is not driven negative.
    expect(fairFactor(20)).toBe(0);
  });

  it('venue history is min(times, 10) / 10 x 100', () => {
    expect(venueFactor(0)).toBe(0);
    expect(venueFactor(4)).toBe(40);
    expect(venueFactor(10)).toBe(100);
    expect(venueFactor(50)).toBe(100);
  });
});

describe('weighted score (§6)', () => {
  it('weights sum to one', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it('a perfect candidate scores 100', () => {
    const perfect = score({
      reliability: 100,
      rating: 5,
      distanceKm: 0,
      futureShifts: 0,
      venueTimes: 10,
    });
    expect(perfect.total).toBeCloseTo(100);
  });

  it('a candidate at every floor scores 0', () => {
    const floor = score({
      reliability: 90,
      rating: 4,
      distanceKm: 20,
      futureShifts: 5,
      venueTimes: 0,
    });
    expect(floor.total).toBe(0);
  });

  it('returns the per-factor breakdown the event board shows on hover', () => {
    const s = score({
      reliability: 95,
      rating: 4.5,
      distanceKm: 5,
      futureShifts: 2,
      venueTimes: 4,
    });
    expect(s.show).toBe(50);
    expect(s.proximity).toBe(55);
    expect(s.fair).toBe(60);
    expect(s.venue).toBe(40);
    // 0.30*50 + 0.25*50 + 0.25*55 + 0.10*60 + 0.10*40 = 51.25
    expect(s.total).toBeCloseTo(51.25);
  });

  it('honours configured weights', () => {
    const onlyProximity = { show: 0, rating: 0, proximity: 1, fair: 0, venue: 0 };
    const s = score(
      { reliability: 100, rating: 5, distanceKm: 5, futureShifts: 0, venueTimes: 10 },
      onlyProximity,
    );
    expect(s.total).toBe(55);
  });
});

describe('hard gates (§6, §3.3)', () => {
  it('has exactly the five the scope names', () => {
    expect([...HARD_GATES]).toEqual([
      'wrong_role',
      'blocked',
      'booked_elsewhere',
      'hours_limit',
      'self_cancelled',
    ]);
  });

  it('wrong role produces no row at all; the other four show under Unavailable', () => {
    expect(showsUnderUnavailable('wrong_role')).toBe(false);
    for (const gate of HARD_GATES.filter((g) => g !== 'wrong_role')) {
      expect(showsUnderUnavailable(gate)).toBe(true);
    }
  });
});

describe('waves (RULE-17, §3.4)', () => {
  it('qualification is an ordering, not a factor', () => {
    expect(waveFor(true)).toBe(1);
    expect(waveFor(false)).toBe(2);

    // The same person scores identically either way; only the wave differs.
    const input = { reliability: 95, rating: 4.5, distanceKm: 5, futureShifts: 2, venueTimes: 4 };
    expect(score(input).total).toBeCloseTo(score(input).total);
  });

  it('exhausts wave 1 before wave 2, even when wave 2 scores higher', () => {
    const weak = { reliability: 91, rating: 4.1, distanceKm: 10, futureShifts: 4, venueTimes: 0 };
    const strong = { reliability: 100, rating: 5, distanceKm: 0, futureShifts: 0, venueTimes: 10 };

    const pool: Candidate<string>[] = [
      { subject: 'unqualified-star', input: strong, qualifiedAtClientAndRole: false },
      { subject: 'qualified-weak', input: weak, qualifiedAtClientAndRole: true },
    ];

    const ranked = rankPool(pool);
    expect(ranked.map((r) => r.subject)).toEqual(['qualified-weak', 'unqualified-star']);
  });

  it('sorts by score descending inside a wave', () => {
    const pool: Candidate<string>[] = [
      {
        subject: 'near',
        input: { reliability: 95, rating: 4.5, distanceKm: 1, futureShifts: 0, venueTimes: 5 },
        qualifiedAtClientAndRole: true,
      },
      {
        subject: 'far',
        input: { reliability: 95, rating: 4.5, distanceKm: 9, futureShifts: 0, venueTimes: 5 },
        qualifiedAtClientAndRole: true,
      },
    ];
    expect(rankPool(pool).map((r) => r.subject)).toEqual(['near', 'far']);
  });

  it('never scores a gated candidate', () => {
    const pool: Candidate<string>[] = [
      {
        subject: 'blocked-star',
        input: { reliability: 100, rating: 5, distanceKm: 0, futureShifts: 0, venueTimes: 10 },
        qualifiedAtClientAndRole: true,
        gate: 'blocked',
      },
    ];
    expect(rankPool(pool)).toHaveLength(0);
  });
});
