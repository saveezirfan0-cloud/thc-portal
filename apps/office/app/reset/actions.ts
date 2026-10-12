'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';
import { NOT_A_RESET_SESSION, isRecoverySession } from './recovery';

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * the shared landing), reached from the Back Office's A1/A2.
 *
 * The emailed link lands on /auth/confirm, which exchanges it for a
 * session before this runs. Without that session there is nothing to
 * update, and saying so plainly is the difference between asking for a new
 * link and giving up.
 *
 * Every other device is signed out afterwards: that is what a reset is FOR
 * when the reason is a lost laptop or a shared password.
 *
 * Then routed by role (§1.4). An admin lands on the dashboard. Anybody
 * else who reset through this app has a new password for THEIR app, and is
 * signed out here rather than shown the wrong-app page.
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
    return 'Setting a password is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(await cookies());
  // Only a session an emailed reset link made may set a password without
  // the current one (security review 12.10). Any other signed-in session —
  // a password sign-in on a desk left unlocked — is refused and sent to
  // My profile → Password, which asks for the current password. Verified claims
  // (getClaims checks the token), not the cookie's say-so.
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claimsError || !claims?.sub) {
    return 'This link has expired or has already been used. Request a new one from the sign-in screen.';
  }
  if (!isRecoverySession(claims)) return NOT_A_RESET_SESSION;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', { status: error.status, message: error.message });
    const reason = error.message.toLowerCase();
    return reason.includes('weak') || reason.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or request a new link.';
  }

  // Scope 'others': keep this session, drop the rest.
  await supabase.auth.signOut({ scope: 'others' });

  if (claims.app_metadata?.['role'] !== 'admin') {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/login');
  }

  redirect('/dashboard');
}
