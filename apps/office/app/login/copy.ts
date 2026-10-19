/**
 * A0's copy (wireframes/backoffice/login.html), in a plain module so both
 * the server action and the screen (and their tests) read one string. A
 * 'use server' file may export only async functions.
 */

/** login.html:51 — the one answer for anything that is not an admin signing in correctly. */
export const WRONG_CREDENTIALS =
  'Email or password is incorrect. Try again or reset your password.';

/** login.html:53 — under the password in the error state. */
export const PASSWORD_HINT = 'Check your password — it is case-sensitive.';

/** login.html:39 — ticked by default. */
export const REMEMBER_LABEL = 'Keep me signed in on this device';

/**
 * ADR-0164 (audit M4): a Back Office sign-in lasts
 * settings.office_session_max_hours from the password, however often it is
 * used. Shown above the form when the middleware has just ended one.
 */
export function sessionEndedNotice(hours: string | undefined): string {
  const n = Number(hours);
  const length = Number.isInteger(n) && n >= 1 && n <= 24 ? `${n} hour${n === 1 ? '' : 's'}` : 'a set time';
  return `For security, a Back Office sign-in lasts ${length}. Sign in again to carry on where you were.`;
}
