import { HOLIDAY_RATE } from '@thc/domain';

/**
 * The money on /roles (§9.8).
 *
 * Rates are held in pence here and as `numeric(8,2)` in the database. The
 * 12.07% lives in two places only — `HOLIDAY_RATE` in `packages/domain` and
 * `final_rate()` in SQL — and `130_roles_directory.sql` asserts the two
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

/** "+£1.69" — the holiday column reads as an addition, never as a total. */
export function formatAddition(pence: number): string {
  return `+${formatPounds(pence)}`;
}

/** The value a numeric input carries, e.g. "14.50". */
export function poundsInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

export const MAX_RATE_PENCE = 100_000_00;

/**
 * Reads what the manager typed into the rate field.
 *
 * `null` means "not a rate", which the caller turns into a message rather
 * than a silent zero. A third decimal is rejected rather than rounded: the
 * column is to the penny, and rounding would change a rate without saying
 * so — the database refuses it for the same reason.
 */
export function parseRate(input: string): number | null {
  const trimmed = input.trim().replace(/^£/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const pence = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(pence) || pence < 0 || pence > MAX_RATE_PENCE) return null;
  return pence;
}

/** Pounds from the database (`numeric` arrives as a number) → pence. */
export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}
