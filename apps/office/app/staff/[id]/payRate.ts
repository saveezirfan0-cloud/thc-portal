import { HOLIDAY_RATE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { finalPence, formatAddition, formatPounds, holidayPence, toPence } from '../../roles/money';
import { formatUkStamp } from './profile';
import type { PersonalPayRate } from './types';

/**
 * The personal pay rate on /staff/:id (ADR-0072). Pure, so Vitest drives
 * it directly.
 *
 * The money helpers are /roles' own (`roles/money.ts`): the 12.07% lives in
 * `HOLIDAY_RATE` and `final_rate()` only, and a rate typed here is parsed
 * exactly as a role's rate is — to the penny, a third decimal refused.
 */

/** "Holiday +12.07%" — the label reads the constant, never a typed copy. */
export const HOLIDAY_LABEL = `Holiday +${(HOLIDAY_RATE * 100).toFixed(2)}%`;

export interface PayRateFigures {
  base: string;
  holiday: string;
  final: string;
}

/**
 * Base, holiday broken out, and the final rate — §9.8's three columns for
 * one worker. The holiday reads as an addition ("+£1.53"), never a total.
 */
export function payRateFigures(basePence: number): PayRateFigures {
  return {
    base: formatPounds(basePence),
    holiday: formatAddition(holidayPence(basePence)),
    final: formatPounds(finalPence(basePence)),
  };
}

/** `numeric` from PostgREST arrives as a number, or a string on some paths. */
export function storedPence(row: Pick<PersonalPayRate, 'pay_rate'>): number {
  return toPence(Number(row.pay_rate));
}

/** "Set 29.09.2026 14:02 UK time" — an office stamp, UK only (§1.8). */
export function payRateSetLine(row: Pick<PersonalPayRate, 'set_at'>, format?: TimeFormat): string {
  return `Set ${formatUkStamp(row.set_at, format)}`;
}

/**
 * The database's refusals, in the manager's words. `set_staff_pay_rate`
 * raises these (20261001215000); anything else is shown as it came.
 */
const MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['not_permitted', 'Pay rates are not available for your role.'],
  ['admins_only', 'Only the office can do this.'],
  ['read_only', 'Your role can read the Back Office but not change anything.'],
  ['staff_removed', 'This worker was removed under GDPR; their pay rate stays as it was.'],
  ['cannot be negative', 'A pay rate cannot be negative.'],
  ['to the penny', 'Enter a rate to the penny, e.g. 13.50.'],
];

export function payRateMessage(message: string): string {
  const hit = MESSAGES.find(([code]) => message.includes(code));
  return hit ? hit[1] : message;
}
