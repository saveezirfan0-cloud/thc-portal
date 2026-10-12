'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';
import { NOT_A_RESET_SESSION, isRecoverySession } from './recovery';

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * the shared landing), reached from the Client Portal's A1/A2.
 *
 * /auth/confirm (or /auth/callback) made a session from the emailed link
 * before this runs. Only THAT kind of session may set a password here
 * without the current one (./recovery.ts): any other signed-in session is
 * refused and sent to "Your account → Change password", which re-checks
 * the current password and is throttled (ADR-0051). Before 12.10 any
 * session at all could post this action and take the account.
 *
 * Every other device is signed out afterwards. Only a client gets this far:
 * the middleware answers any other role with the wrong-app page on every
 * path, /reset included, so the old "sign a non-client out after the reset"
 * branch could never run and is gone; the role is checked again here,
 * before anything changes, rather than after.
 */
export async function setPassword(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const checks = checkPassword(password, confirm);
  if (!passwordOk(checks)) return passwordError(checks);

  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return "The portal isn't connected yet. Please contact THC.";
  }

  const supabase = createClient(await cookies());
  // Verified claims, not the cookie's say-so: getClaims checks the token's
  // signature (or asks Auth) before `amr` is believed.
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claimsError || !claims?.sub) {
    return 'This link has expired or has already been used. Request a new one from the sign-in screen.';
  }
  if (!isRecoverySession(claims)) return NOT_A_RESET_SESSION;
  if (claims.app_metadata?.['role'] !== 'client') {
    return 'This reset link is for a different THC app. Open the link you were sent for that app.';
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    const reason = error.message.toLowerCase();
    if (error.code === 'same_password') {
      return 'Choose a new password that is different from your current one.';
    }
    if (error.code === 'reauthentication_needed') {
      return 'This link has expired. Request a new one from the sign-in screen.';
    }
    return reason.includes('weak') || reason.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or request a new link.';
  }

  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' });
  if (othersError) {
    console.error('[reset] sign-out of other devices failed', {
      status: othersError.status,
      code: othersError.code,
    });
  }

  redirect('/client');
}
