import { DEFAULT_WEIGHTS, parseWeights } from '@thc/domain';
import { KANBAN_STAGES } from './types';
import type { ScoringWeights, Senders, WilloStageMap } from './types';

/**
 * What /settings refuses to save (§6, §2.4, §9.11, §9.12).
 *
 * Pure, so the screen and the server action share one answer and the rules
 * can be tested without a database. Every one of these is a setting that
 * fails silently if it is wrong — a weight set that does not sum to 1
 * still produces scores, and a sender address with a typo still sends
 * mail, into the void. Silent failure is what makes them worth validating
 * here rather than trusting an admin to be careful.
 */

/** The five §6 factors, in the order the screen lists them. */
export const WEIGHT_FIELDS: {
  key: keyof ScoringWeights;
  label: string;
  hint: string;
}[] = [
  { key: 'show_rate', label: 'Show rate', hint: 'Shifts turned up to, as a percentage.' },
  { key: 'rating', label: 'Client rating', hint: 'Average star rating out of 5.' },
  {
    key: 'proximity',
    label: 'Proximity',
    hint: 'Home-to-venue distance. Falls away past about 30 km.',
  },
  {
    key: 'fair_rotation',
    label: 'Fair rotation',
    hint: 'Favours workers with fewer shifts already booked.',
  },
  {
    key: 'venue_history',
    label: 'Venue history',
    hint: 'Times this worker has worked this venue before.',
  },
];

/** §6's shipped weights, in the `settings` row's own spelling. */
export const SHIPPED_WEIGHTS: ScoringWeights = {
  show_rate: DEFAULT_WEIGHTS.show,
  rating: DEFAULT_WEIGHTS.rating,
  proximity: DEFAULT_WEIGHTS.proximity,
  fair_rotation: DEFAULT_WEIGHTS.fair,
  venue_history: DEFAULT_WEIGHTS.venue,
};

/** Float noise: 0.30 + 0.25 + 0.25 + 0.10 + 0.10 is not exactly 1 in binary. */
const EPSILON = 0.0005;

export function weightTotal(weights: ScoringWeights): number {
  return (
    weights.show_rate +
    weights.rating +
    weights.proximity +
    weights.fair_rotation +
    weights.venue_history
  );
}

/**
 * The weights must sum to 1.
 *
 * §6's score is a weighted sum of five factors each normalised to 0-100,
 * so a set summing to 0.9 quietly caps every worker at 90 and a set
 * summing to 1.2 pushes the top of the pool past 100. Neither breaks
 * anything visibly — the RANKING is unchanged, which is exactly why this
 * is the kind of mistake that survives for months. The screen refuses it.
 */
export function validateWeights(weights: ScoringWeights): string | null {
  for (const { key, label } of WEIGHT_FIELDS) {
    const value = weights[key];
    if (!Number.isFinite(value)) return `${label} must be a number.`;
    if (value < 0 || value > 1) return `${label} must be between 0 and 1.`;
  }
  const total = weightTotal(weights);
  if (Math.abs(total - 1) > EPSILON) {
    return `The five weights must add up to 1.00 — they currently add up to ${total.toFixed(2)}.`;
  }
  return null;
}

/**
 * Reading the row back. `parseWeights` in @thc/domain is the only sanctioned
 * way to turn the stored JSON into weights (its keys differ from the
 * interface the scorer uses), so this goes through it rather than casting.
 */
export function readWeights(row: unknown): ScoringWeights {
  const parsed = parseWeights(row);
  return {
    show_rate: parsed.show,
    rating: parsed.rating,
    proximity: parsed.proximity,
    fair_rotation: parsed.fair,
    venue_history: parsed.venue,
  };
}

export function validateWillo(map: WilloStageMap): string | null {
  const entries: [string, string][] = [
    ['New response', map.new_response],
    ['Accepted', map.accepted],
    ['Rejected', map.rejected],
  ];
  for (const [label, stage] of entries) {
    if (!(KANBAN_STAGES as readonly string[]).includes(stage)) {
      return `${label} must map to one of: ${KANBAN_STAGES.join(', ')}.`;
    }
  }
  // §2.4: "Rejected in Willo → the system rejects automatically." Pointing
  // it anywhere else turns an automatic rejection into an advancement.
  if (map.rejected !== 'rejected') {
    return 'A Willo rejection must map to the Rejected stage (§2.4).';
  }
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * §9.12 is explicit that ALL outgoing mail comes from one of two addresses
 * and that "no-reply addresses are not used", because replies to either go
 * to a monitored mailbox. An address starting `no-reply` or `noreply` is
 * therefore refused rather than accepted with a warning.
 */
export function validateSenders(senders: Senders): string | null {
  const entries: [string, string][] = [
    ['Timesheets sender', senders.timesheets],
    ['Admin sender', senders.admin],
  ];
  for (const [label, address] of entries) {
    if (!EMAIL.test(address.trim())) return `${label} is not a valid email address.`;
    if (/^no-?reply@/i.test(address.trim())) {
      return `${label}: no-reply addresses are not used — replies go to a monitored mailbox (§9.12).`;
    }
  }
  return null;
}

/** §9.11: the slider's range, and so the range a standard radius may sit in. */
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 3000;

export function validateRadius(label: string, metres: number): string | null {
  if (!Number.isInteger(metres)) return `${label}: the radius is a whole number of metres.`;
  if (metres < MIN_RADIUS_M || metres > MAX_RADIUS_M) {
    return `${label}: the radius must be between ${MIN_RADIUS_M} m and ${MAX_RADIUS_M} m (§9.11).`;
  }
  return null;
}

export function validateGap(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 0) {
    return 'The different-venue gap is a whole number of minutes.';
  }
  if (minutes > 24 * 60) return 'A different-venue gap longer than a day would gate every shift.';
  return null;
}

export function validateEscalationRadius(miles: number): string | null {
  if (!Number.isFinite(miles) || miles <= 0) return 'The escalation radius must be more than zero.';
  if (miles > 100) return 'An escalation radius over 100 miles is not a local escalation.';
  return null;
}
