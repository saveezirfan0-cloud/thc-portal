'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { readRecoverySession } from '@thc/db/recovery';
import { clearSignInFailures } from '@thc/db/auth-throttle';
import { createClient } from '@thc/db/server';
import { USE_ACCOUNT_SCREEN } from './copy';

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

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', { status: error.status, message: error.message });
    const reason = error.message.toLowerCase();
    return reason.includes('weak') || reason.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or request a new link.';
  }

  // The guesses made before this (an account with no password yet refuses
  // every one) must not refuse the password just set (20261015140000).
  await clearSignInFailures(user.email);

  // Scope 'others': keep this session, drop the rest.
  await supabase.auth.signOut({ scope: 'others' });

  if (user.app_metadata?.['role'] !== 'admin') {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/login');
  }

  redirect('/dashboard');
}
