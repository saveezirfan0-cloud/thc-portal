'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';
import { WRONG_CREDENTIALS } from './copy';
import { REMEMBER_FIELD, SESSION_ONLY_COOKIE, markerOptions, sessionScopedStore } from './session';

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
  // "Keep me signed in on this device": ticked by default, so the field is
  // absent only when the person unticked it (see ./session.ts).
  const remember = formData.get(REMEMBER_FIELD) !== null;

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  const store = await cookies();
  const supabase = createClient(remember ? store : sessionScopedStore(store));
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
    return WRONG_CREDENTIALS;
  }

  // The marker tells the middleware to keep every refreshed cookie
  // session-scoped too; clearing it on a ticked sign-in undoes an earlier
  // unticked one on the same browser.
  if (remember) store.set(SESSION_ONLY_COOKIE, '', { ...markerOptions(), maxAge: 0 });
  else store.set(SESSION_ONLY_COOKIE, '1', markerOptions());

  redirect(next);
}
