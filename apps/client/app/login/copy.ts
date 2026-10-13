/**
 * The sign-in card's copy (wireframes/client/login.html), in a plain module
 * so the server action, the form and their tests read one string. A
 * `'use server'` file may export only async functions.
 */

/** login.html:123 — the one answer, whichever half was wrong. */
export const WRONG_CREDENTIALS =
  'The email or password is incorrect. Check both and try again, or reset your password.';

/** login.html:62 — under the heading, desktop. */
export const LEAD = 'Your events, confirmed line-ups and timesheets — read-only.';

/** login.html:65 — ticked by default. */
export const REMEMBER_LABEL = 'Keep me signed in on this device';

/**
 * Supabase Auth's own rate limit answered (429). Its limit is per address,
 * and every customer reaches it from Vercel's, so it is nobody's fault and
 * names no account: the per-account limit (packages/db/src/auth-throttle.ts)
 * answers with WRONG_CREDENTIALS instead.
 */
export const SUPABASE_BUSY = 'Too many attempts. Wait a few minutes and try again.';
