/**
 * The one sign-in refusal (§1.4, `wireframes/backoffice/login.html`).
 *
 * A wrong email, a wrong password and a correct login for an account that
 * has no business in the Back Office all read the same. Kept out of
 * `actions.ts` because a 'use server' module may export async functions only.
 */
export const SIGN_IN_REFUSED = 'Email or password is incorrect. Try again or reset your password.';
