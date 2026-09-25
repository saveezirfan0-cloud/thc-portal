/**
 * The sign-in card's copy (wireframes/client/login.html), in a plain module
 * so the server action, the form and their tests read one string. A
 * `'use server'` file may export only async functions.
 */

/** login.html:123 — the one answer, whichever half was wrong. */
export const WRONG_CREDENTIALS =
  'The email or password is incorrect. Check both and try again, or reset your password.';

/** login.html:65 — ticked by default. */
export const REMEMBER_LABEL = 'Keep me signed in on this device';
