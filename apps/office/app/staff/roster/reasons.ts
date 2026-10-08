/**
 * Why the database did not take (or held) a row of the invite list, in a
 * sentence the office can act on (ADR-0105).
 *
 * Its own module on purpose: `actions.ts` is a `'use server'` file, which may
 * export only async functions — anything else a client component imports from
 * it compiles to a server reference and reads as `undefined` in the browser.
 */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  bad_email: 'Not an email address',
  group_unknown: 'Group not understood — use SpudBros Express or THC',
  bad_payroll_id: 'Payroll ID can only hold letters, digits and hyphens',
  duplicate_email_in_file: 'This email is in the list twice',
  duplicate_payroll_id_in_file: 'This Payroll ID is in the list twice',
  payroll_id_taken: 'Another person already has this Payroll ID',
  has_upcoming_shifts:
    'Already here with an upcoming shift — not switched to SpudBros; move the shift first',
  name_mismatch:
    'The name on the sheet is not the name of the worker who has this email — nothing was changed. Check the email',
  already_marked_spudbros: 'Already marked SpudBros Express — a list never switches them back',
};
