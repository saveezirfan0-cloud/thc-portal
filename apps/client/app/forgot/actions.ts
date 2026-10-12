'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { appOrigin, recoveryRedirect } from '@thc/db';
import { createClient } from '@thc/db/server';
import { THROTTLED, takeAuthAttempt } from '../auth/throttle';
import { RESET_SENT_COOKIE, resetSentCookieOptions } from './sent/flash';

/**
 * A1 Forgot password — §10.2, `wireframes/client/login.html` (forgot).
 *
 * The outcome is IDENTICAL whether or not the address is registered: a "no
 * account with that email" message would let anyone test which venue
 * contacts have a portal login (§1.7).
 *
 * Throttled per email (3 an hour) and per caller (10 an hour) before
 * Supabase is asked (ADR-0115, app/auth/throttle.ts). The limit counts any
 * address, registered or not, so being throttled reveals nothing either.
 *
 * A2 names the address back to the visitor. It travels in a short-lived,
 * httpOnly cookie scoped to /forgot/sent, never in the URL: a query string
 * lands in browser history, proxy logs and Referer headers, and
 * `?to=<anything>` made the branded page print whatever text a link put
 * there.
 *
 * The email is Supabase Auth's recovery mail, which lands on this app's
 * /auth/confirm and hands off to A3 (/reset). The sender, admin@ (§9.12),
 * is a project setting.
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
    return "The portal isn't connected yet. Please contact THC.";
  }

  const origin = appOrigin(process.env['NEXT_PUBLIC_CLIENT_URL'], 'http://127.0.0.1:3002');
  if (!origin) {
    console.error('[reset] NEXT_PUBLIC_CLIENT_URL is not set; cannot build the reset link');
    return 'Password reset is not available on this deployment yet. Email admin@thehospitalitycompany.co.uk.';
  }

  if ((await takeAuthAttempt('reset', email, await headers())) === 'blocked') return THROTTLED;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // /auth/confirm takes the token_hash link (any browser, any device) and
    // the PKCE code alike (supabase/templates/recovery.html, ADR-0039).
    redirectTo: recoveryRedirect(origin),
  });

  if (error) {
    // Logged, not shown: a rate limit and an unknown address look the same.
    console.error('[reset] request failed', { status: error.status, message: error.message });
  }

  cookieStore.set(RESET_SENT_COOKIE, email, resetSentCookieOptions());
  redirect('/forgot/sent');
}
