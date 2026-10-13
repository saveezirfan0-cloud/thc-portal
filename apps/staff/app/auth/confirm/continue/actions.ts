'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';
import { clearTimeFormatCookie } from '@thc/db/time-format';

/**
 * "Continue" on the reset interstitial (./page.tsx): the one place the
 * emailed recovery token is spent.
 *
 * A server action, so Next refuses a POST whose Origin is not this app
 * (no other site can submit someone's token_hash here and sign the visitor
 * in to the wrong account — login CSRF), and a GET — a mail scanner, a link
 * preview — never reaches it.
 *
 * Only `type=recovery` tokens are made into sessions here; `next` is
 * honoured only as a path on this origin (packages/db/src/redirect.ts).
 */
export async function continueReset(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const next = safeNextPath(formData.get('next'), '/reset');
  if (!tokenHash) redirect('/reset?error=missing');

  const jar = await cookies();
  // A new session: the clock is read from THIS login's profile, not the last one's (ADR-0085).
  clearTimeFormatCookie(jar);
  const supabase = createClient(jar);
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
  if (error) {
    console.error('[auth] recovery token rejected', {
      status: error.status,
      message: error.message,
    });
    redirect('/reset?error=expired');
  }
  redirect(next);
}
