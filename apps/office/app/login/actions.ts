'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  KEEP_SIGNED_IN_FIELD,
  keepSignedInCookie,
  persistenceFromForm,
  safeNextPath,
} from '@thc/db';
import { createClient } from '@thc/db/server';
import { SIGN_IN_REFUSED } from './messages';
import { nextLevelFor, verifyStepPath } from './two-step';

/**
 * Email + password sign-in (§1.4).
 *
 * The failure message never distinguishes a wrong email from a wrong
 * password: saying which one is wrong tells an attacker whether an account
 * exists. The wireframes word it that way deliberately.
 *
 * A Client Portal (or Staff) account signing in here is refused THE SAME
 * WAY — `wireframes/backoffice/login.html`, error state: "A client-portal
 * account signing in here is refused the same way (role-based routing,
 * §1.4)". Admitting the session and letting middleware answer with the
 * wrong-app page would tell whoever is typing that the password was right
 * and which app the account belongs to. So the session is dropped here,
 * before it is ever used, and the form shows the generic message.
 */
export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // Only ever a path on this app (§1.4): see packages/db/src/redirect.ts.
  const next = safeNextPath(formData.get('next'), '/dashboard');

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  // "Keep me signed in on this device" (ADR-0032): ticked by default on the
  // form; unticked, the auth cookies this sign-in writes are session cookies.
  // Passed explicitly because the preference cookie is written below, after
  // the sign-in succeeds, and so is not in this request's cookies yet.
  const persistence = persistenceFromForm(formData.get(KEEP_SIGNED_IN_FIELD));
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore, { persistence });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
    return SIGN_IN_REFUSED;
  }

  // The same source the middleware reads: app_metadata, never user_metadata,
  // which the user can write themselves.
  const role = data?.user?.app_metadata?.['role'];
  if (role !== 'admin') {
    // Local scope: this browser's session only. A client signed in to the
    // Client Portal elsewhere stays signed in there.
    await supabase.auth.signOut({ scope: 'local' });
    console.warn('[sign-in] refused a non-admin account at the Back Office', {
      role: typeof role === 'string' ? role : null,
    });
    return SIGN_IN_REFUSED;
  }

  // Remembered for every later writer of the auth cookies: middleware's
  // token refresh, route handlers, the browser client (packages/db/src/session.ts).
  const preference = keepSignedInCookie(persistence);
  cookieStore.set(preference.name, preference.value, preference.options);

  // Two-step sign-in (ADR-0037): a password alone is aal1. A login with a
  // verified authenticator goes to the code step before anything else, with
  // `next` carried through; the middleware would send it there anyway, this
  // just saves the round trip. Set after the preference cookie above, so the
  // session the code step upgrades keeps this device's choice.
  if (nextLevelFor(data?.user?.factors) === 'aal2') redirect(verifyStepPath(next));

  redirect(next);
}
