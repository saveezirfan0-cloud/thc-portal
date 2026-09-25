'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appOrigin, recoveryRedirect } from '@thc/db';
import { createClient } from '@thc/db/server';

/**
 * A1 Forgot password — §10.2, `wireframes/backoffice/login.html` (forgot).
 *
 * The outcome is IDENTICAL whether or not the address is registered: a "no
 * account with that email" message turns this screen into a tool for
 * testing who has a Back Office login (§1.7; the same reason the sign-in
 * error never says which field was wrong).
 *
 * The email is Supabase Auth's recovery mail, which lands on this app's
 * /auth/confirm and hands off to A3 (/reset). The sender, admin@ (§9.12),
 * is a project setting, not something this code can assert.
 */
export async function requestReset(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) return 'Enter the email address you sign in with.';

  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return 'Password reset is not available yet — this environment has no Supabase project.';
  }

  const origin = appOrigin(process.env['NEXT_PUBLIC_OFFICE_URL'], 'http://127.0.0.1:3000');
  if (!origin) {
    console.error('[reset] NEXT_PUBLIC_OFFICE_URL is not set; cannot build the reset link');
    return 'Password reset is not available on this deployment yet. Contact the THC office.';
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // /auth/confirm takes the token_hash link (any browser, any device) and
    // the PKCE code alike (supabase/templates/recovery.html, ADR-0035).
    redirectTo: recoveryRedirect(origin),
  });

  if (error) {
    // Logged, not shown. A rate limit and an unknown address must look the
    // same to whoever is typing.
    console.error('[reset] request failed', { status: error.status, message: error.message });
  }

  redirect(`/forgot/sent?to=${encodeURIComponent(email)}`);
}
