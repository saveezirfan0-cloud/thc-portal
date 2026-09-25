/**
 * The code step's words, in a plain module so the page, the action and the
 * tests read one string ('use server' files export async functions only).
 */

export const VERIFY_HEADING = 'Enter your code';

export const VERIFY_INTRO =
  'Your login has two-step sign-in. Open the authenticator app on your phone and type the 6-digit code it shows for THC Back Office.';

/** Lost phone: nobody in the app can reset it today (ADR-0037, Recovery). */
export const VERIFY_LOST_PHONE =
  'Lost or replaced your phone? The code cannot be skipped. Ask whoever looks after THC’s system to reset two-step sign-in for your login, then sign in with your password and set it up again.';

/** A verified factor of a kind this screen cannot challenge (not TOTP). */
export const NO_AUTHENTICATOR =
  'Your login is protected by a kind of second step this screen cannot ask for. Ask whoever looks after THC’s system to reset two-step sign-in for your login.';
