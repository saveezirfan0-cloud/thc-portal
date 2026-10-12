'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { checkPassword, passwordError, passwordOk } from './rules';
import { NOT_A_RESET_SESSION, isRecoverySession } from './recovery';

/**
 * A3 Set new password — §10.2.
 *
 * Reached from the emailed recovery link, which /auth/confirm exchanges
 * for a session before this runs. Without that session there is nothing to
 * update, and saying so plainly ("the link has expired") is the difference
 * between a worker asking for a new link and a worker giving up.
 *
 * Every other device is signed out afterwards, which is what the wireframe
 * promises and what a password reset is FOR when the reason is a lost or
 * shared phone.
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
  // the current one (./recovery.ts, security review 12.10). Any other
  // signed-in session goes to Profile → Security settings, which asks for
  // the current password first. Verified claims, not the cookie's say-so.
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !data?.claims?.sub) {
    return 'This link has expired or has already been used. Ask for a new one from the sign-in screen.';
  }
  if (!isRecoverySession(data.claims)) return NOT_A_RESET_SESSION;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', { status: error.status, message: error.message });
    // Supabase rejects a password it has seen in a breach corpus when leaked
    // password protection is on, and one identical to the current password
    // (`same_password`); both reasons ARE useful to the worker.
    const text = error.message.toLowerCase();
    if (error.code === 'same_password' || text.includes('different from the old')) {
      return 'That is the password you use now. Choose a different one.';
    }
    return text.includes('weak') || text.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or ask for a new link.';
  }

  // Scope 'others': keep this session, drop the rest.
  await supabase.auth.signOut({ scope: 'others' });

  redirect('/shifts');
}
