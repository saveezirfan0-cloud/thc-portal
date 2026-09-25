'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { officeOrigin } from '../origin';

/**
 * A1 Forgot password — §10.2, wireframes/backoffice/login.html (state
 * `forgot`).
 *
 * The outcome is IDENTICAL whether or not the address is registered, and
 * that is the whole design (login.html:78): a "no account with that email"
 * answer turns this form into a probe for which addresses hold an account
 * (§1.7 — the same reason A0's error never says which field was wrong).
 *
 * The email itself is Supabase Auth's recovery mail, sent from admin@
 * (§9.12, a project setting this code cannot assert). Its link lands on
 * /login/callback, which exchanges the code for a session and hands off
 * to A3 at /login/reset.
 */
export async function requestReset(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) return 'Enter the email you sign in with.';

  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return 'Password reset is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${officeOrigin()}/login/callback?next=/login/reset`,
  });

  if (error) {
    // Logged, not shown. A rate limit and an unknown address must look the
    // same to whoever is typing.
    console.error('[reset] request failed', { status: error.status, message: error.message });
  }

  redirect(`/login/forgot/sent?to=${encodeURIComponent(email)}`);
}
