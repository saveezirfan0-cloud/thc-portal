/**
 * A1/A2 Forgot password — the numbers the screens quote, in one place so the
 * copies cannot disagree (§10.2).
 *
 * The recovery link is a Supabase Auth email OTP, and its lifetime is the
 * project-wide "Email OTP Expiration" — one value for invite, magic-link and
 * recovery mail alike. This repo sets it to a day: `otp_expiry = 86400` in
 * `supabase/config.toml`, and the same figure on the hosted project's
 * dashboard (OWNER-TODO.md §1, docs/16-owner-guide.md §1.1) so an activation
 * opened the next morning still works. A screen that says "60 minutes" against
 * that setting is wrong by 23 hours, so the sentence is derived from the hours.
 */
export const RESET_LINK_HOURS = 24;

/** "24 hours" — as printed in "The link is valid for …" / "It expires in …". */
export const RESET_LINK_VALIDITY = `${RESET_LINK_HOURS} hours`;

/**
 * The address the reset was requested for, shown back on A2 and used by its
 * Resend button. A short-lived httpOnly cookie rather than a query string so
 * the worker's email stays out of browser history, the request logs and any
 * Referer (§1.7; the same shape as `/apply`'s `thc_apply_sent_to`).
 */
export const SENT_TO_COOKIE = 'thc_reset_sent_to';

/** Seconds the cookie lives — long enough to read the screen, not to linger. */
export const SENT_TO_MAX_AGE = 600;

/**
 * What the form (and Resend on A2) says once an address has used its three
 * links for the hour (packages/db/src/auth-throttle.ts, ADR-0157).
 *
 * It says nothing about the account. The count is kept for every address
 * typed here, registered or not, so this answer is the same for both and
 * does not turn the form into a test of who has a login (§1.7). It must not
 * claim a link was sent: for an address with no account none was.
 */
export const RESET_LIMIT_REACHED =
  'You’ve asked for a reset link too many times. Please wait an hour before trying again. If you asked earlier, check your inbox and your spam folder.';

/** §9.12 — the sender of everything that is not an allocation sheet or timesheet. */
export const RESET_SENDER = 'admin@thehospitalitycompany.co.uk';
