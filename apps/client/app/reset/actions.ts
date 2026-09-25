'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * the shared landing), reached from the Client Portal's A1/A2.
 *
 * /auth/confirm (or /auth/callback) made a session from the emailed link before this
 * runs; without it there is nothing to update. Every other device is
 * signed out afterwards. Then routed by role (§1.4): a client lands on the
 * portal; anybody else who reset through this app has a new password for
 * their own app and is signed out here rather than shown the wrong-app page.
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

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[reset] update failed', { status: error.status, message: error.message });
    const reason = error.message.toLowerCase();
    return reason.includes('weak') || reason.includes('pwned')
      ? 'That password has appeared in a known data breach. Choose a different one.'
      : 'We could not set that password. Try again, or request a new link.';
  }

  await supabase.auth.signOut({ scope: 'others' });

  if (user.app_metadata?.['role'] !== 'client') {
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/login');
  }

  redirect('/client');
}
