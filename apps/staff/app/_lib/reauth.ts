import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentPasswordCheckAllowed, recordCurrentPasswordFailure } from '@thc/db/auth-throttle';

/**
 * The current-password step (ADR-0113) in front of the writes a stolen,
 * still-signed-in phone must not make on its own: bank details (Profile →
 * Payment information, and the wizard's step 9), Request my P45, and a new
 * email address. The same check `changePassword` has always made: sign in
 * again with the SESSION's address — never one the browser sent (audit
 * D52) — and the typed password.
 *
 * The caller then makes the write on the SAME client, so the request
 * carries the fresh session, whose `amr` holds the password sign-in that
 * `staff_save_bank` and `request_my_p45` look for (`recent_password_auth()`,
 * 20261012120900 — `reauth_required` otherwise).
 *
 * Returns null when the password is right, or the sentence to show.
 */
export const WRONG_PASSWORD = 'That current password isn’t right.';
export const PASSWORD_REQUIRED = 'Enter your current password to continue.';
export const SIGN_IN_AGAIN = 'Please sign in again to continue.';
export const REAUTH_REQUIRED = 'For your security, please enter your current password again.';
export const TOO_MANY_TRIES = 'Too many wrong passwords. Wait 15 minutes, then try again.';

export async function confirmCurrentPassword(
  supabase: SupabaseClient,
  password: string,
): Promise<string | null> {
  if (typeof password !== 'string' || password.length === 0) return PASSWORD_REQUIRED;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return SIGN_IN_AGAIN;
  // Counted with the sign-in form's own per-account limit, so a stolen
  // session cannot guess the password here any faster than at /login.
  if (!(await currentPasswordCheckAllowed(user.email))) return TOO_MANY_TRIES;
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (!error) return null;
  await recordCurrentPasswordFailure(user.email);
  return WRONG_PASSWORD;
}
