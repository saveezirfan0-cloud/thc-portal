'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { isActivationToken, parseActivationType } from '@thc/db/activation';
import { createClient } from '@thc/db/server';

/**
 * Accept a Client Portal invitation (/users, ADR-0055): choose a password.
 *
 * The one-time token is spent HERE, on submit — not when the page loads —
 * so a link preview in a chat app or an email scanner opening the link
 * does not use it up (the Staff App's /activate works the same way).
 * The password is checked first for the same reason: a token is not
 * spent on a form that was going to be refused anyway.
 */
export async function acceptInvite(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const token = String(formData.get('token') ?? '');
  const type = parseActivationType(formData.get('type'));
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const checks = checkPassword(password, confirm);
  if (!passwordOk(checks)) return passwordError(checks);
  if (!isActivationToken(token)) {
    return 'This link is incomplete. Open it again from the message you were sent.';
  }
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return 'Setting a password is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: token });
  if (error || !data.user) {
    return 'This invitation has expired or has already been used. Ask the THC office for a new link.';
  }
  if (data.user.app_metadata?.['role'] !== 'client') {
    await supabase.auth.signOut({ scope: 'local' });
    return 'This invitation is for a different THC app. Open the link you were sent for that app.';
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.error('[invite] password not set', {
      status: updateError.status,
      message: updateError.message,
    });
    return /weak|pwned/i.test(updateError.message)
      ? 'That password has appeared in a known data breach. Choose a different one — then use “Forgot password” on the sign-in screen, as this link is now used.'
      : 'Your login is ready but the password could not be saved. Use “Forgot password” on the sign-in screen to set one.';
  }

  redirect('/client');
}
