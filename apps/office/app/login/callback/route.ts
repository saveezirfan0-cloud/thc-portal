import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@thc/db/server';
import { safeNext } from '../safeNext';

/**
 * Where the Back Office's emailed reset link lands — §10.2 (A3).
 *
 * Supabase sends a one-time `code` that has to be exchanged for a session
 * on the server; the recovery link is useless without this step, and A3
 * would show "this link has expired" for every link ever sent.
 *
 * `next` is only ever honoured as a path on this origin (safeNext.ts). An
 * open redirect on the end of an emailed link is a phishing kit: the mail
 * is genuinely from THC, and the page it lands on would not be.
 */
const RESET_PATH = '/login/reset';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'), RESET_PATH);

  if (!code) {
    return NextResponse.redirect(new URL(`${RESET_PATH}?error=missing`, url.origin));
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth] code exchange failed', { status: error.status, message: error.message });
    return NextResponse.redirect(new URL(`${RESET_PATH}?error=expired`, url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
