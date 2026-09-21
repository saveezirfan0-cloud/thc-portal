/**
 * Weekly cap — RULE-20 (Scope §4.4–4.5).
 *
 * The cap is CALCULATED, never stored and never typed by a manager.
 * This module resolves the *band* a worker is in for a given Mon–Sun week.
 * Summing the worker's hours for that week lives in SQL, because auto-assign
 * has to filter on it inside a query: see `weekly_cap_hours(staff, date)`.
 * Both implementations are held to `cap.vectors.json`.
 *
 * Phase 0 ships the band resolution and the vectors. The `compliance` bot
 * completes the SQL side and the profile explanation string in Phase 4.
 */

export type TermState = 'none' | 'term' | 'holiday' | 'straddle';

export type CapBand =
  'student_term_20' | 'student_holiday_48' | 'graduated_48' | 'standard_48' | 'uncapped';

export interface CapInput {
  /** The worker's Right to Work carries a working-hours limit (student visa). */
  visaLimited: boolean;
  /** Where the Mon–Sun week sits against the worker's term dates. */
  termState: TermState;
  /** A completion letter has been verified by a manager (§4.5). */
  completionLetterVerified: boolean;
  /** The worker has signed the 48-hour working time opt-out. */
  optOut48h: boolean;
}

export interface CapResult {
  /** Null means no ceiling. */
  capHours: number | null;
  band: CapBand;
}

export function weeklyCap(input: CapInput): CapResult {
  if (input.visaLimited) {
    // A verified completion letter graduates the worker off the term cap.
    if (input.completionLetterVerified) return { capHours: 48, band: 'graduated_48' };
    // A week straddling term and holiday takes the lower cap.
    if (input.termState === 'term' || input.termState === 'straddle') {
      return { capHours: 20, band: 'student_term_20' };
    }
    return { capHours: 48, band: 'student_holiday_48' };
  }

  // No ceiling only with the opt-out AND no visa limit.
  if (input.optOut48h) return { capHours: null, band: 'uncapped' };
  return { capHours: 48, band: 'standard_48' };
}

/** Hours still available this week, or null when the worker is uncapped. */
export function remainingHours(cap: CapResult, bookedHours: number): number | null {
  if (cap.capHours === null) return null;
  return Math.max(0, cap.capHours - bookedHours);
}
