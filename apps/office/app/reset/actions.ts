'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { readRecoverySession } from '@thc/db/recovery';
import {
  authAttemptAllowed,
  clearSignInFailures,
  recordAuthAttempt,
  userKey,
} from '@thc/db/auth-throttle';
import { createClient } from '@thc/db/server';
import { staffUrlIsOffice } from '../_lib/staffUrl';
import { codeError, explainCodeError, normaliseCode } from '../login/two-step';
import { readTwoStep } from '../login/two-step-session';
import { NO_AUTHENTICATOR, TOO_MANY_CODES } from '../login/verify/copy';
import { SAME_PASSWORD, USE_ACCOUNT_SCREEN, otherApp } from './copy';

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
 * else is refused BEFORE anything changes and told which app their login is
 * for (the Client Portal does the same): changing the password and then
 * signing them out sent a worker round the reset loop, because the sign-in
 * screen cannot say "wrong app" without confirming the password was right.
 *
 * A login with two-step (ADR-0057) types its 6-digit code here as well:
 * GoTrue refuses a password change below aal2 once a factor is verified
 * (`insufficient_aal`), and a reset link opens an aal1 session. The code
 * is checked like /login/verify's — same throttle, same words — and only
 * after the link and the role have passed, so a wrong code costs nothing
 * else. A lost phone is not solved here: the factor is reset on /users
 * first (ADR-0060), and then no code is asked.
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

  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { user, decision, totp } = await readTwoStep(supabase);
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
  const role = user.app_metadata?.['role'];
  if (role !== 'admin') {
    const staffUrl = process.env['NEXT_PUBLIC_STAFF_URL'];
    return otherApp(role, staffUrl && !staffUrlIsOffice() ? staffUrl : undefined);
  }

  if (decision === 'verify') {
    if (!totp) return NO_AUTHENTICATOR;
    const code = normaliseCode(formData.get('code'));
    const invalid = codeError(code);
    if (invalid) return invalid;
    const keys = [await userKey(user.id)];
    if (!(await authAttemptAllowed('verify', keys))) return TOO_MANY_CODES;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (error) {
      console.error('[reset] code refused', { status: error.status, code: error.code });
      if (error.code === 'mfa_verification_failed' || error.code === 'mfa_verification_rejected') {
        await recordAuthAttempt('verify', keys, true);
      }
      return explainCodeError(error);
    }
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    if (error.code === 'same_password') return SAME_PASSWORD;
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

  redirect('/dashboard');
}
