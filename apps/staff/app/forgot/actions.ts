'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { SENT_TO_COOKIE, SENT_TO_MAX_AGE } from './copy';

/**
 * A1 Forgot password — §10.2, wireframes/staff/auth.html. Also the action
 * behind A2's "Didn't get it? Resend" button, which posts the same address.
 *
 * The outcome is IDENTICAL whether or not the address is registered, and
 * that is the whole design: a "no account with that email" message turns
 * this screen into a tool for testing which of 1,000 workers exists (§1.7,
 * the same reason A0's error never says which field was wrong).
 *
 * The email itself is Supabase Auth's recovery mail, which lands on
 * /auth/callback and hands off to A3. §9.12's sender (admin@) is therefore
 * Auth's SMTP sender, a project setting this code cannot assert: the owner
 * step is docs/16-owner-guide.md §1.3b (custom SMTP through Resend, sender
 * admin@thehospitalitycompany.co.uk / "The Hospitality Company"). Until it is
 * done the hosted project's built-in mailer sends this email, and only to
 * the project team.
 */
export async function requestReset(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) return 'Enter the email address you signed up with.';

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  if (!url || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return 'Password reset is not available yet — this environment has no Supabase project.';
  }

  const jar = await cookies();
  const supabase = createClient(jar);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appOrigin()}/auth/callback?next=/reset`,
  });

  if (error) {
    // Logged, not shown. A rate limit and an unknown address must look the
    // same to whoever is typing.
    console.error('[reset] request failed', { status: error.status, message: error.message });
  }

  // The address is shown back on A2 and reused by its Resend button. It goes
  // in a short-lived cookie rather than the URL so it stays out of browser
  // history, the request logs and any Referer the next screen sends (§1.7).
  jar.set(SENT_TO_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SENT_TO_MAX_AGE,
    path: '/forgot',
  });

  redirect('/forgot/sent');
}

/**
 * Where the emailed link must come back to. Vercel sets VERCEL_URL without
 * a scheme; locally the app is on :3001. Getting this wrong sends workers
 * to a link that opens the wrong app.
 */
function appOrigin(): string {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://127.0.0.1:3001';
}
