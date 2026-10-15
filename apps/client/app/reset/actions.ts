'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { readRecoverySession } from '@thc/db/recovery';
import { clearSignInFailures } from '@thc/db/auth-throttle';
import { createClient } from '@thc/db/server';
import { OTHER_APP, USE_ACCOUNT_SCREEN } from './copy';

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * the shared landing), reached from the Client Portal's A1/A2.
 *
 * /auth/confirm (or /auth/callback) made a session from the emailed link before this
 * runs; without it there is nothing to update. Every other device is
 * signed out afterwards, and the client lands on the portal.
 *
 * Only a client's password is set here (§1.4). Another app's login is
 * refused BEFORE anything changes: a Back Office password reset from the
 * customer app would sit outside its own two-step flow. (The middleware
 * already gives a non-client the wrong-app page on every path; this is the
 * action's own check, not a second route.)
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return 'This link has expired or has already been used. Request a new one from the sign-in screen.';
  }

  // No current password is asked for here, so the session itself must be
  // the proof: made by a reset link, in the last 15 minutes (verified `amr`
  // claims, packages/db/src/recovery.ts). A session from a password sign-in
  // — or a borrowed device that is simply signed in — changes the password
  // on the screen that asks for the current one.
  const recovery = await readRecoverySession(supabase);
  if (recovery.state === 'none') {
    return 'This link has expired or has already been used. Request a new one from the sign-in screen.';
  }
  if (recovery.state !== 'recent') return USE_ACCOUNT_SCREEN;
  if (user.app_metadata?.['role'] !== 'client') return OTHER_APP;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    if (error.code === 'same_password') {
      return 'Choose a new password that is different from your current one.';
    }
    if (error.code === 'reauthentication_needed') {
      return 'This link has expired. Request a new one from the sign-in screen.';
    }
    const reason = error.message.toLowerCase();
    return reason.includes('weak') || reason.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or request a new link.';
  }

  // The guesses made before this (an account with no password yet refuses
  // every one) must not refuse the password just set (20261015140000).
  await clearSignInFailures(user.email);

  await supabase.auth.signOut({ scope: 'others' });

  redirect('/client');
}
