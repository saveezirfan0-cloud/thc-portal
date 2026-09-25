import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, parseWeights, score } from '@thc/domain';
import {
  SHIPPED_WEIGHTS,
  readWeights,
  validateEscalationRadius,
  validateGap,
  validateRadius,
  validateSenders,
  validateWeights,
  validateWillo,
  validateWilloReviewUrlTemplate,
  weightTotal,
} from '../validate';
import type { ScoringWeights } from '../types';

const weights = (over: Partial<ScoringWeights> = {}): ScoringWeights => ({
  ...SHIPPED_WEIGHTS,
  ...over,
});

describe('scoring weights (§6)', () => {
  it('ships with 0.30 / 0.25 / 0.25 / 0.10 / 0.10', () => {
    expect(SHIPPED_WEIGHTS).toEqual({
      show_rate: 0.3,
      rating: 0.25,
      proximity: 0.25,
      fair_rotation: 0.1,
      venue_history: 0.1,
    });
    expect(weightTotal(SHIPPED_WEIGHTS)).toBeCloseTo(1, 5);
    expect(validateWeights(SHIPPED_WEIGHTS)).toBeNull();
  });

  it('refuses a set that does not add up to 1.00', () => {
    // The trap this exists for: the ranking is IDENTICAL, so nothing looks
    // broken — every score is just quietly capped at 90.
    const short = weights({ show_rate: 0.2 });
    expect(weightTotal(short)).toBeCloseTo(0.9, 5);
    expect(validateWeights(short)).toContain('0.90');
  });

  it('refuses a weight outside 0–1', () => {
    expect(validateWeights(weights({ rating: -0.1 }))).toContain('between 0 and 1');
    expect(validateWeights(weights({ rating: 1.4 }))).toContain('between 0 and 1');
  });

  it('refuses a non-number', () => {
    expect(validateWeights(weights({ proximity: Number.NaN }))).toContain('must be a number');
  });

  it('tolerates binary float noise in a legitimate set', () => {
    expect(validateWeights(weights({ show_rate: 0.35, rating: 0.2 }))).toBeNull();
  });

  it('round-trips through the settings row’s own key spelling', () => {
    // The row spells them show_rate / fair_rotation / venue_history; the
    // scorer's interface is show / fair / venue. Getting this wrong makes
    // every total NaN, which sorts arbitrarily rather than throwing.
    const stored = weights({ show_rate: 0.4, proximity: 0.15 });
    const parsed = parseWeights(stored);
    expect(parsed.show).toBe(0.4);
    expect(parsed.proximity).toBe(0.15);
    expect(readWeights(stored)).toEqual(stored);
  });

  it('falls back to the shipped default for a cleared field, never to zero', () => {
    expect(readWeights({ show_rate: 0.3 }).rating).toBe(DEFAULT_WEIGHTS.rating);
  });

  it('a saved weight really does move the ranking', () => {
    // B14's acceptance test, stated as arithmetic: the same two workers,
    // two weight sets, two different winners — no deployment in between.
    const near = { reliability: 70, rating: 3, distanceKm: 1, futureShifts: 0, venueTimes: 0 };
    const reliable = {
      reliability: 100,
      rating: 5,
      distanceKm: 40,
      futureShifts: 0,
      venueTimes: 0,
    };

    const proximityLed = parseWeights(
      weights({
        proximity: 0.7,
        show_rate: 0.1,
        rating: 0.1,
        fair_rotation: 0.05,
        venue_history: 0.05,
      }),
    );
    const reliabilityLed = parseWeights(
      weights({
        proximity: 0.05,
        show_rate: 0.6,
        rating: 0.25,
        fair_rotation: 0.05,
        venue_history: 0.05,
      }),
    );

    expect(score(near, proximityLed).total).toBeGreaterThan(score(reliable, proximityLed).total);
    expect(score(reliable, reliabilityLed).total).toBeGreaterThan(
      score(near, reliabilityLed).total,
    );
  });
});

describe('Willo stage map (§2.4)', () => {
  it('accepts the shipped mapping', () => {
    expect(
      validateWillo({
        new_response: 'interview_completed',
        accepted: 'documents',
        rejected: 'rejected',
      }),
    ).toBeNull();
  });

  it('refuses a stage that is not on the kanban', () => {
    expect(
      validateWillo({ new_response: 'compliant', accepted: 'documents', rejected: 'rejected' }),
    ).toContain('must map to one of');
  });

  it('refuses a rejection pointed anywhere but Rejected', () => {
    // §2.4: "Rejected in Willo → the system rejects automatically."
    // Mapping it to Documents would ADVANCE a rejected candidate.
    expect(
      validateWillo({
        new_response: 'interview_completed',
        accepted: 'documents',
        rejected: 'documents',
      }),
    ).toContain('§2.4');
  });
});

describe('sender addresses (§9.12)', () => {
  const good = {
    timesheets: 'timesheets@thehospitalitycompany.co.uk',
    admin: 'admin@thehospitalitycompany.co.uk',
  };

  it('accepts the two the scope names', () => {
    expect(validateSenders(good)).toBeNull();
  });

  it('refuses a malformed address', () => {
    expect(validateSenders({ ...good, admin: 'admin@' })).toContain('not a valid email');
  });

  it('refuses a no-reply address — replies go to a monitored mailbox', () => {
    expect(validateSenders({ ...good, admin: 'no-reply@thehospitalitycompany.co.uk' })).toContain(
      'no-reply',
    );
    expect(validateSenders({ ...good, admin: 'noreply@thehospitalitycompany.co.uk' })).toContain(
      'no-reply',
    );
  });
});

describe('venue-type radii (§9.11)', () => {
  it('accepts the slider’s whole range', () => {
    expect(validateRadius('Hotel', 100)).toBeNull();
    expect(validateRadius('Outdoor or festival site', 3000)).toBeNull();
  });

  it('refuses anything outside 100–3000 m', () => {
    expect(validateRadius('Hotel', 50)).toContain('between 100 m and 3000 m');
    expect(validateRadius('Hotel', 5000)).toContain('between 100 m and 3000 m');
  });

  it('refuses a fractional metre', () => {
    expect(validateRadius('Hotel', 150.5)).toContain('whole number');
  });
});

describe('auto-assign limits (§3.4)', () => {
  it('accepts the shipped two-hour different-venue gap', () => {
    expect(validateGap(120)).toBeNull();
  });

  it('refuses a negative or fractional gap', () => {
    expect(validateGap(-15)).not.toBeNull();
    expect(validateGap(12.5)).not.toBeNull();
  });

  it('refuses a gap so long it would gate every shift', () => {
    expect(validateGap(2000)).toContain('longer than a day');
  });

  it('accepts the shipped three-mile escalation radius', () => {
    expect(validateEscalationRadius(3)).toBeNull();
  });

  it('refuses zero or a nationwide radius', () => {
    expect(validateEscalationRadius(0)).not.toBeNull();
    expect(validateEscalationRadius(500)).toContain('not a local escalation');
  });
});

describe('the Willo review link template (§2.4)', () => {
  it('accepts blank — Willo is not connected yet — and an https URL carrying {id}', () => {
    expect(validateWilloReviewUrlTemplate('')).toBeNull();
    expect(validateWilloReviewUrlTemplate('   ')).toBeNull();
    expect(
      validateWilloReviewUrlTemplate('https://app.willo.video/thc/candidates/{id}'),
    ).toBeNull();
  });

  it('refuses a template that would send every card to the same page', () => {
    expect(validateWilloReviewUrlTemplate('https://app.willo.video/thc/candidates')).toMatch(
      /\{id\}/,
    );
  });

  it('refuses a non-URL and a plain http link', () => {
    expect(validateWilloReviewUrlTemplate('willo {id}')).toMatch(/not a valid URL/);
    expect(validateWilloReviewUrlTemplate('http://app.willo.video/{id}')).toMatch(/https/);
  });
});
