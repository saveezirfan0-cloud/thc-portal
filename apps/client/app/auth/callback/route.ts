import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';

/**
 * Where the Client Portal's emailed reset link lands — §10.2 (A1 → A3).
 *
 * Supabase sends a one-time `code` that has to be exchanged for a session
 * on the server; without this step /reset would show "this link has
 * expired" for every link ever sent.
 *
 * `next` is only ever honoured as a path on this origin (the shared guard in
 * packages/db/src/redirect.ts): an open redirect on the end of a genuine THC
 * email is a phishing kit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'), '/reset', url.origin);

  if (!code) {
    return NextResponse.redirect(new URL('/reset?error=missing', url.origin));
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth] code exchange failed', { status: error.status, message: error.message });
    return NextResponse.redirect(new URL('/reset?error=expired', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
