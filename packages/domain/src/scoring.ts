/**
 * Auto-assign scoring — Scope §6. Pure maths, no AI.
 *
 * A match score of 0–100 is a weighted sum of five factors, each normalised
 * to 0–100 and clamped. The weights are configurable (they live in the
 * `settings` table, §6), so nothing here hard-codes them beyond the default.
 *
 * Two things the scope is emphatic about, and which are easy to get wrong:
 *
 *  - Client qualification is NOT a factor. It is an ORDERING: the qualified
 *    pool is scored and exhausted first, then the rest (RULE-17, §3.4). A
 *    weighting could be out-scored by proximity or rotation, and THC asked
 *    for a rule, not a nudge.
 *  - Hard gates are not scored at all. A gated worker never gets a score.
 */

export interface ScoreWeights {
  show: number;
  rating: number;
  proximity: number;
  fair: number;
  venue: number;
}

/** §6. Editable in settings; this is the shipped default. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  show: 0.3,
  rating: 0.25,
  proximity: 0.25,
  fair: 0.1,
  venue: 0.1,
};

export interface ScoreInput {
  /** Show-rate as a percentage, 0–100. */
  reliability: number;
  /** Client rating out of 5. */
  rating: number;
  /** Haversine distance from the worker's home to the venue, in km. */
  distanceKm: number;
  /** Shifts the worker already has booked in the future. */
  futureShifts: number;
  /** Times the worker has previously worked this venue. */
  venueTimes: number;
}

export interface ScoreBreakdown {
  show: number;
  rating: number;
  proximity: number;
  fair: number;
  venue: number;
  /** The weighted total, 0–100. */
  total: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/** (reliability − 90) / 10 × 100, clamped. Below 90% scores zero. */
export function showFactor(reliability: number): number {
  return clamp(((reliability - 90) / 10) * 100);
}

/** (rating − 4.0) / 1.0 × 100, clamped. At or below 4.0 scores zero. */
export function ratingFactor(rating: number): number {
  return clamp(((rating - 4.0) / 1.0) * 100);
}

/** 100 − km × 9, clamped. Past about 11 km this is zero. */
export function proximityFactor(distanceKm: number): number {
  return clamp(100 - distanceKm * 9);
}

/** 100 − min(future shifts, 5) × 20. Five or more future shifts scores zero. */
export function fairFactor(futureShifts: number): number {
  return clamp(100 - Math.min(futureShifts, 5) * 20);
}

/** min(times, 10) / 10 × 100. Ten previous shifts at the venue is full marks. */
export function venueFactor(venueTimes: number): number {
  return clamp((Math.min(venueTimes, 10) / 10) * 100);
}

/**
 * The full breakdown. The event board shows every factor on hover, so the
 * parts are returned alongside the total rather than thrown away (§6).
 */
export function score(input: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS): ScoreBreakdown {
  const show = showFactor(input.reliability);
  const rating = ratingFactor(input.rating);
  const proximity = proximityFactor(input.distanceKm);
  const fair = fairFactor(input.futureShifts);
  const venue = venueFactor(input.venueTimes);

  const total =
    show * weights.show +
    rating * weights.rating +
    proximity * weights.proximity +
    fair * weights.fair +
    venue * weights.venue;

  return { show, rating, proximity, fair, venue, total };
}

/**
 * Hard gates (§6, §3.3). A gated worker is never scored.
 *
 * `wrong_role` behaves differently on screen from the other four: it produces
 * no row on the event board at all, not even under Unavailable, because
 * listing every unqualified worker would bury the section. The other four do
 * appear under Unavailable with the reason shown, since those people would
 * otherwise be genuine candidates and the manager needs to see why they are
 * not in the pool.
 */
export const HARD_GATES = [
  'wrong_role',
  'blocked',
  'booked_elsewhere',
  'hours_limit',
  'self_cancelled',
] as const;

export type HardGate = (typeof HARD_GATES)[number];

/** True when the gate should still show the worker under Unavailable (§3.3). */
export function showsUnderUnavailable(gate: HardGate): boolean {
  return gate !== 'wrong_role';
}

/**
 * Invitation waves (RULE-17, §3.4). Qualified at this client AND role goes
 * first; everyone else follows. Not being qualified is never a hard gate.
 */
export type Wave = 1 | 2;

export function waveFor(qualifiedAtClientAndRole: boolean): Wave {
  return qualifiedAtClientAndRole ? 1 : 2;
}

export interface Candidate<T> {
  subject: T;
  input: ScoreInput;
  qualifiedAtClientAndRole: boolean;
  /** Present means the candidate is gated and must not be scored. */
  gate?: HardGate;
}

export interface RankedCandidate<T> {
  subject: T;
  wave: Wave;
  breakdown: ScoreBreakdown;
}

/**
 * Ranks a pool for one role section: wave 1 scored and exhausted first, then
 * wave 2, each sorted by score descending. Gated candidates are dropped.
 */
export function rankPool<T>(
  candidates: readonly Candidate<T>[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): RankedCandidate<T>[] {
  return candidates
    .filter((c) => c.gate === undefined)
    .map((c) => ({
      subject: c.subject,
      wave: waveFor(c.qualifiedAtClientAndRole),
      breakdown: score(c.input, weights),
    }))
    .sort((a, b) => (a.wave !== b.wave ? a.wave - b.wave : b.breakdown.total - a.breakdown.total));
}
