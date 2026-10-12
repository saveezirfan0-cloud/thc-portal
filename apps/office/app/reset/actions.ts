'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';

/**
 * Is this a session an emailed reset link just made? Supabase Auth writes
 * how a session began into the access token's `amr` claim: `recovery` for a
 * reset link (token_hash or PKCE), `otp` for an emailed code. The entry's
 * timestamp is when that proof was given; after an hour the session is an
 * ordinary one. The Client Portal and Staff App hold the same rule in
 * app/reset/recovery.ts.
 */
const RECOVERY_WINDOW_SECONDS = 60 * 60;

const NOT_A_RESET_SESSION =
  'You are already signed in. To change your password, go to My profile → Password. To reset a forgotten password, sign out and use “Forgot password” on the sign-in screen.';

function isRecoverySession(claims: { amr?: unknown }): boolean {
  const now = Math.floor(Date.now() / 1000);
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return (
      (method === 'recovery' || method === 'otp') &&
      typeof timestamp === 'number' &&
      now - timestamp <= RECOVERY_WINDOW_SECONDS &&
      timestamp <= now + 60
    );
  });
}

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
