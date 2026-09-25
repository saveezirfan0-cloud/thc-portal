/**
 * /settings — the Django-Admin replacement (§6, §2.4, §9.11, §9.12).
 *
 * The scope names four things THC must be able to change "without a
 * release": the §6 scoring weights, the Willo stage map (§2.4), the
 * standard venue-type radii (§9.11) and the sender addresses (§9.12).
 * Three of them live in the key/value `settings` table; the fourth already
 * has a proper home in `venue_types`, which the venue modal pre-fills
 * from, so this screen edits that table rather than shadowing it.
 */

export interface ScoringWeights {
  show_rate: number;
  rating: number;
  proximity: number;
  fair_rotation: number;
  venue_history: number;
}

/**
 * §2.4: the "Review interview on Willo" link, as a template with `{id}`
 * where Willo's candidate id goes (onboarding_candidates_v substitutes it).
 * Null until THC supplies the Willo account; the link is then "not connected".
 */
export type WilloReviewUrlTemplate = string | null;

/** §2.4, Appendix B: Willo's own stage names → the kanban's. */
export interface WilloStageMap {
  new_response: string;
  accepted: string;
  rejected: string;
}

/** §9.12: exactly two addresses, and no others are used. */
export interface Senders {
  timesheets: string;
  admin: string;
}

export interface VenueTypeRadius {
  key: string;
  label: string;
  default_radius_m: number;
  sort_order: number;
}

export interface SettingsData {
  weights: ScoringWeights;
  willo: WilloStageMap;
  willoReviewUrlTemplate: WilloReviewUrlTemplate;
  senders: Senders;
  /**
   * §8's fixed recipients for the office/payroll emails, read from the
   * notification register on the server so the screen's note can never
   * drift from what the drain sends. Not a setting.
   */
  recipients: { e5e6: string[]; e7: string[] };
  /** RULE-06's different-venue gap, in minutes (§3.4). */
  bookedElsewhereGapMinutes: number;
  /** §3.4's escalation radius, in miles. */
  escalationRadiusMiles: number;
  venueTypes: VenueTypeRadius[];
  /**
   * Completion letter requirement §4: what the rota does with a Working Time
   * 48 h breach. Never a Student visa limit or a right-to-work expiry, which
   * are always refused (20260923100200_rota_guard.sql).
   */
  rotaGuardMode: RotaGuardMode;
  problem: string | null;
}

export type RotaGuardMode = 'block' | 'warn';

export type ActionResult = { ok: true } | { ok: false; message: string };

/** The kanban stages a Willo outcome may map onto (§2.2, §2.4). */
export const KANBAN_STAGES = [
  'interview_requested',
  'interview_completed',
  'documents',
  'rejected',
] as const;
