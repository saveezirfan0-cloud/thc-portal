import { HOLIDAY_RATE } from '@thc/domain';

/**
 * The money on /roles (§9.8).
 *
 * Rates are held in pence here and as `numeric(8,2)` in the database. The
 * 12.07% lives in two places only — `HOLIDAY_RATE` in `packages/domain` and
 * `final_rate()` in SQL — and `150_roles_directory.sql` asserts the two
 * agree at every penny. This module is the screen's side of that.
 */

/** Holiday pay, broken out and never blended into the base (§9.8, §1.5). */
export function holidayPence(basePence: number): number {
  return Math.round(basePence * HOLIDAY_RATE);
}

/** Base + holiday. All margin across the system is computed from this. */
export function finalPence(basePence: number): number {
  return basePence + holidayPence(basePence);
}

/** "£14.00". */
export function formatPounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * "+£1.20" / "−£5.69" — a margin, signed with a real minus sign (U+2212),
 * never "£-5.69" (release audit D-M7).
 */
export function formatSignedPounds(pence: number): string {
  return `${pence < 0 ? '−' : '+'}${formatPounds(Math.abs(pence))}`;
}

/** "+£1.69" — the holiday column reads as an addition, never as a total. */
export function formatAddition(pence: number): string {
  return `+${formatPounds(pence)}`;
}

/** The value a numeric input carries, e.g. "14.50". */
export function poundsInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

/**
 * The ceiling on an hourly pay rate: above £1,000.00 is a typo, not a rate
 * (999999 used to come back as "not a rate"). assert_pay_floor() in SQL
 * holds the same line (20261014160000).
 */
export const MAX_RATE_PENCE = 1_000_00;

/**
 * The statutory floor when the database's cannot be read: the UK National
 * Living Wage for 21 and over, £12.71 from 1 April 2026 (GOV.UK, "National
 * Minimum Wage and National Living Wage rates"; £12.21 in 2025/26). The
 * live figure is `settings.minimum_hourly_pay`, read through
 * `minimum_pay_rate()` (`loadPayFloorPence`), and changes each April
 * without a release (ADR-0137).
 */
export const DEFAULT_PAY_FLOOR_PENCE = 1271;

/**
 * Reads what the manager typed into the rate field.
 *
 * `null` means "not a rate", which the caller turns into a message rather
 * than a silent zero. A third decimal is rejected rather than rounded: the
 * column is to the penny, and rounding would change a rate without saying
 * so — the database refuses it for the same reason. A well-formed figure
 * out of range is still a number: `payRateProblem` says what is wrong
 * with it.
 */
export function parseRate(input: string): number | null {
  const trimmed = input.trim().replace(/^£/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const pence = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(pence) || pence < 0) return null;
  return pence;
}

/**
 * Why a typed base pay rate cannot be saved, in the manager's words, or
 * null when it can (release audit D-M7). `floorPence` is today's
 * National Living Wage; `keepPence`, on an edit, is the stored rate — a
 * role priced under an older floor can be saved unchanged.
 */
export function payRateProblem(
  input: string,
  floorPence: number,
  keepPence: number | null = null,
): string | null {
  const trimmed = input.trim().replace(/^£/, '').replace(/,/g, '');
  if (trimmed === '') return 'Enter a rate.';
  if (/^\d+\.\d{3,}$/.test(trimmed)) return 'Enter a rate to the penny, e.g. 13.50.';
  const pence = parseRate(input);
  if (pence === null) return 'Enter a rate in pounds and pence, e.g. 13.50.';
  if (pence > MAX_RATE_PENCE) {
    return 'A pay rate over £1,000.00 an hour is refused — check the figure.';
  }
  if (pence < floorPence && pence !== keepPence) {
    return `A pay rate cannot be below the National Living Wage, ${formatPounds(floorPence)}/h.`;
  }
  return null;
}

/** Pounds from the database (`numeric` arrives as a number) → pence. */
export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}
