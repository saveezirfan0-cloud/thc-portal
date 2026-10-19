/**
 * A1 Forgot password: what the form says once an address has used its three
 * links for the hour (packages/db/src/auth-throttle.ts, ADR-0157).
 *
 * It says nothing about the account. The count is kept for every address
 * typed here, registered or not, so this answer is the same for both and
 * does not turn the form into a test of who has a login (§1.7). It must not
 * claim a link was sent: for an address with no account none was.
 */
export const RESET_LIMIT_REACHED =
  'You’ve asked for a reset link too many times. Please wait an hour before trying again. If you asked earlier, check your inbox and your spam folder.';
