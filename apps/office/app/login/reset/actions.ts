'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { checkPassword, passwordError, passwordOk } from './rules';

/**
 * A3 Set new password — §10.2.
 *
 * Reached from the emailed recovery link, which /login/callback exchanges
 * for a session before this runs. Without that session there is nothing to
 * update, and saying so plainly ("the link has expired") is the difference
 * between a manager asking for a new link and giving up.
 *
 * Only an admin account is admitted here (§1.4): a Client Portal account
 * that used the Back Office's reset form gets its password changed nowhere
 * and is signed out of this host, the same "refused the same way" answer
 * A0 gives it.
 *
 * Every other device is signed out afterwards, which is what a password
 * reset is FOR when the reason is a lost or shared laptop.
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
    return 'This link has expired or has already been used. Ask for a new one from the sign-in screen.';
  }
  if (user.app_metadata?.['role'] !== 'admin') {
    await supabase.auth.signOut({ scope: 'local' });
    return 'This link has expired or has already been used. Ask for a new one from the sign-in screen.';
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', { status: error.status, message: error.message });
    // Supabase rejects a password it has seen in a breach corpus when leaked
    // password protection is on; that reason IS useful to the manager.
    return error.message.toLowerCase().includes('weak') ||
      error.message.toLowerCase().includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or ask for a new link.';
  }

  // Scope 'others': keep this session, drop the rest.
  await supabase.auth.signOut({ scope: 'others' });

  redirect('/dashboard');
}
