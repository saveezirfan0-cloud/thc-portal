'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_ONLY_COOKIE, SESSION_ONLY_COOKIE_OPTIONS, safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';

/**
 * Email + password sign-in (§1.4).
 *
 * The failure message never distinguishes a wrong email from a wrong
 * password: saying which one is wrong tells an attacker whether an account
 * exists. The wireframes word it that way deliberately.
 */
export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // Only ever a path on this app (§1.4): see packages/db/src/redirect.ts.
  // /client is the portal's home; /events was never a route here.
  const next = safeNextPath(formData.get('next'), '/client');
  // client/login.html, ticked by default. Unticked: session cookies (ADR-0035).
  const remember = formData.get('remember') === '1';

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  const jar = await cookies();
  const supabase = createClient(jar, { sessionOnly: !remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // The visitor gets a message that reveals nothing; the real reason goes to
    // the server log, where an operator can see whether this was a genuine bad
    // password or a misconfiguration (wrong project, provider disabled, a key
    // that does not match the URL). Without this the two are indistinguishable.
    console.error('[sign-in] rejected', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    return 'Email or password is incorrect. Try again or reset your password.';
  }

  rememberChoice(jar, remember);
  redirect(next);
}

/**
 * The marker every later token refresh reads (middleware, server client,
 * browser client — packages/db/src/session.ts), so an unticked sign-in
 * stays a session-cookie sign-in until the browser closes.
 */
function rememberChoice(jar: Awaited<ReturnType<typeof cookies>>, remember: boolean): void {
  if (remember) {
    jar.delete(SESSION_ONLY_COOKIE);
    return;
  }
  jar.set(SESSION_ONLY_COOKIE, '1', {
    ...SESSION_ONLY_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
  });
}
