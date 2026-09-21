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
  const { visaLimited, termState, completionLetterVerified, optOut48h } = input;

  // The 20-hour visa condition, and the ONLY place the opt-out cannot reach.
  // §4.4: "the opt-out cannot lift this, because it is a visa condition".
  // A verified completion letter graduates the worker off it entirely (§4.5),
  // and a week straddling term and holiday takes the lower cap. `none` means
  // no verified term letter, so no holiday range can be proved: the SQL
  // reaches 20 the same way, by finding no day inside a holiday range, and
  // the safe reading is the one the scope applies automatically.
  const studentTermCapped = visaLimited && !completionLetterVerified && termState !== 'holiday';
  if (studentTermCapped) return { capHours: 20, band: 'student_term_20' };

  // Everywhere else the 48-hour week is Working Time Regulations, not a visa
  // condition, so a signed opt-out lifts it — including for a student in a
  // holiday range and for a graduated student. §4.4 gives "48 h — or no
  // ceiling with a signed opt-out" for both of those rows, and the opt-out
  // table reads "International student … Out of term — yes".
  if (optOut48h) return { capHours: null, band: 'uncapped' };

  const band: CapBand = !visaLimited
    ? 'standard_48'
    : completionLetterVerified
      ? 'graduated_48'
      : 'student_holiday_48';

  return { capHours: 48, band };
}

/** Hours still available this week, or null when the worker is uncapped. */
export function remainingHours(cap: CapResult, bookedHours: number): number | null {
  if (cap.capHours === null) return null;
  return Math.max(0, cap.capHours - bookedHours);
}
