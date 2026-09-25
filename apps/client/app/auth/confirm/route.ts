import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';

/**
 * Where the Client Portal's emailed reset link lands — §10.2 (A1 → A3),
 * ADR-0035.
 *
 * The recovery template (supabase/templates/recovery.html) links here with
 * `token_hash` + `type=recovery`, which verifyOtp turns into a session in
 * ANY browser: no PKCE code verifier is needed, so a link opened on another
 * device, in a mail app's in-app browser or outside the PWA still works
 * (audit D13). A project still on the default template sends GoTrue's
 * /verify link instead, which redirects here with a PKCE `code`; that is
 * exchanged exactly as /auth/callback does, so either template works.
 *
 * Only `type=recovery` is accepted: this route makes reset sessions and
 * nothing else. `next` is honoured only as a path on this origin (the
 * shared guard in packages/db/src/redirect.ts).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'), '/reset', url.origin);

  if (tokenHash && type === 'recovery') {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    if (error) {
      console.error('[auth] recovery token rejected', {
        status: error.status,
        message: error.message,
      });
      return NextResponse.redirect(new URL('/reset?error=expired', url.origin));
    }
    return NextResponse.redirect(new URL(next, url.origin));
  }

  if (code) {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth] code exchange failed', {
        status: error.status,
        message: error.message,
      });
      return NextResponse.redirect(new URL('/reset?error=expired', url.origin));
    }
    return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL('/reset?error=missing', url.origin));
}
