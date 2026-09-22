'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';

/**
 * A1 Forgot password — §10.2, wireframes/staff/auth.html.
 *
 * The outcome is IDENTICAL whether or not the address is registered, and
 * that is the whole design: a "no account with that email" message turns
 * this screen into a tool for testing which of 1,000 workers exists (§1.7,
 * the same reason A0's error never says which field was wrong).
 *
 * The email itself is Supabase Auth's recovery mail, which lands on
 * /auth/callback and hands off to A3. §9.12's sender (admin@) is a project
 * setting, not something this code can assert.
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

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appOrigin()}/auth/callback?next=/reset`,
  });

  if (error) {
    // Logged, not shown. A rate limit and an unknown address must look the
    // same to whoever is typing.
    console.error('[reset] request failed', { status: error.status, message: error.message });
  }

  redirect(`/forgot/sent?to=${encodeURIComponent(email)}`);
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
