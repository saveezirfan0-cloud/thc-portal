/**
 * Weekly cap — RULE-20 (Scope §4.4–4.5).
 *
 * The cap is CALCULATED, never stored and never typed by a manager. It is
 * derived, every time it is needed, from the holiday ranges on the worker's
 * verified University Term Dates Letter, their `graduated_at` and their
 * 48-hour opt-out.
 *
 * This module owns the band resolution. Summing the worker's hours for the
 * week lives in SQL, because auto-assign has to filter on it inside a query:
 * see `weekly_booked_hours(staff, date)` and `weekly_cap_would_breach(staff,
 * shift)` in supabase/migrations/0006_weekly_cap.sql. Both implementations
 * are held to `cap.vectors.json` — Vitest runs the vectors against
 * `weeklyCap()` below, pgTAP runs the same generated table against the SQL
 * `weekly_cap()`.
 */

/**
 * Where a Mon–Sun week sits against the HOLIDAY ranges read off the term
 * letter. `none` means no ranges are on file at all; for a visa-limited
 * worker that reads as term time, because every day of the week then falls
 * outside every holiday range (§4.4 table, row 3).
 */
export type TermState = 'none' | 'term' | 'holiday' | 'straddle';

export type CapBand =
  'student_term_20' | 'student_holiday_48' | 'graduated_48' | 'standard_48' | 'uncapped';

/** What set the cap — the §9.6 Student visa view lists this next to the number. */
export type CapEvidence = 'completion_letter' | 'term_letter' | 'none';

export interface CapInput {
  /** The worker's Right to Work carries a working-hours limit (student visa). */
  visaLimited: boolean;
  /** Where the Mon–Sun week sits against the worker's holiday ranges. */
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

/**
 * True where the 20-hour visa condition is in force: a student-visa worker
 * who has not graduated, in a week that is not wholly holiday. A straddling
 * week counts — §4.4: "A week in which term restarts on the Thursday is a
 * 20-hour week, not a 48-hour one." No opt-out can lift this.
 */
function inTermVisaLimit(input: CapInput): boolean {
  return input.visaLimited && !input.completionLetterVerified && input.termState !== 'holiday';
}

export function weeklyCap(input: CapInput): CapResult {
  // 1. The visa condition first: it beats both the opt-out and the calendar.
  if (inTermVisaLimit(input)) return { capHours: 20, band: 'student_term_20' };
  // 2. Everywhere else the opt-out removes the ceiling (§4.4 opt-out table).
  if (input.optOut48h) return { capHours: null, band: 'uncapped' };
  // 3. Otherwise 48, labelled by what produced it.
  if (input.visaLimited) {
    return input.completionLetterVerified
      ? { capHours: 48, band: 'graduated_48' }
      : { capHours: 48, band: 'student_holiday_48' };
  }
  return { capHours: 48, band: 'standard_48' };
}

/** Which document set this worker's cap (§4.5 reporting, §9.6 Student visa view). */
export function capEvidence(input: CapInput): CapEvidence {
  if (!input.visaLimited) return 'none';
  return input.completionLetterVerified ? 'completion_letter' : 'term_letter';
}

/** Hours still available this week, or null when the worker is uncapped. */
export function remainingHours(cap: CapResult, bookedHours: number): number | null {
  if (cap.capHours === null) return null;
  return Math.max(0, cap.capHours - bookedHours);
}

// ---------------------------------------------------------------------
// Term state from the letter
// ---------------------------------------------------------------------

/** An inclusive `[from, to]` holiday range off the verified term letter. */
export interface HolidayRange {
  /** ISO `YYYY-MM-DD`. */
  from: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  to: string;
}

const DAY_MS = 86_400_000;

/** Monday of the Mon–Sun week containing `isoDate`, as `YYYY-MM-DD`. */
export function capWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // getUTCDay(): 0 = Sunday. Monday-based offset.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

/** The seven `YYYY-MM-DD` dates of the Mon–Sun week containing `isoDate`. */
export function capWeekDays(isoDate: string): string[] {
  const monday = new Date(`${capWeekStart(isoDate)}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday + i * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * Where the Mon–Sun week containing `isoDate` sits against the holiday
 * ranges. Mirrors `cap_term_state(daterange[], date)` in SQL: `holiday` only
 * when EVERY day of the week is inside a range, `term` when none is, and
 * `straddle` in between — which RULE-20 then resolves to the lower cap.
 *
 * With no ranges on file every day is outside every range, so this returns
 * `term`, never `none`. `none` is reserved for workers the term letter does
 * not apply to at all.
 */
export function resolveTermState(
  holidays: readonly HolidayRange[],
  isoDate: string,
): Exclude<TermState, 'none'> {
  const inHoliday = capWeekDays(isoDate).map((day) =>
    holidays.some((r) => day >= r.from && day <= r.to),
  );
  if (inHoliday.every(Boolean)) return 'holiday';
  return inHoliday.some(Boolean) ? 'straddle' : 'term';
}

// ---------------------------------------------------------------------
// The profile line (§2.3, §4.4 "displayed, never edited")
// ---------------------------------------------------------------------

export interface CapExplanationContext {
  /**
   * The day the current band runs to — the last day of the holiday range the
   * week sits in, or the day before the next one starts. Omitted where there
   * is nothing to run to (no term letter, or the band never changes again).
   */
  until?: string;
  /** `graduated_at` — the day the completion letter was verified (§4.5). */
  graduatedOn?: string;
}

/** `13.12.2026` — the profile writes UK dates (§1.8). */
function ukDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * The profile line, e.g. "20 h/week — term time until 13.12.2026",
 * "48 h/week — university holiday until 05.01.2027", or "48 h/week —
 * graduated, completion letter verified 04.07.2026" (§2.3, §4.4, §4.5).
 * There is no field to type a number into — this is the whole display.
 */
export function explainCap(
  input: CapInput,
  cap: CapResult,
  context: CapExplanationContext = {},
): string {
  const until = context.until ? ` until ${ukDate(context.until)}` : '';
  switch (cap.band) {
    case 'student_term_20':
      return `20 h/week — term time${until}`;
    case 'student_holiday_48':
      return `48 h/week — university holiday${until}`;
    case 'graduated_48':
      return context.graduatedOn
        ? `48 h/week — graduated, completion letter verified ${ukDate(context.graduatedOn)}`
        : '48 h/week — graduated, completion letter verified';
    case 'standard_48':
      return '48 h/week';
    case 'uncapped':
      return capEvidence(input) === 'completion_letter'
        ? 'No weekly limit — graduated, 48-hour opt-out signed'
        : 'No weekly limit — 48-hour opt-out signed';
  }
}
