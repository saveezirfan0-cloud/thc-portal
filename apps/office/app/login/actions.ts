'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { WRONG_CREDENTIALS } from './copy';
import { safeNext } from './safeNext';
import { rememberedCookies } from './sessionCookies';

/**
 * Email + password sign-in (§1.4).
 *
 * The failure message never distinguishes a wrong email from a wrong
 * password: saying which one is wrong tells an attacker whether an account
 * exists. The wireframes word it that way deliberately.
 *
 * A Client Portal (or staff) account is "refused the same way"
 * (wireframes/backoffice/login.html:55): its credentials are checked, but
 * the office never keeps its session — the cookies are cleared before the
 * answer goes back, and the answer is the same sentence. The middleware's
 * 403 page stays as the backstop for a session minted somewhere else.
 */
export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // A path on this origin or the landing route — never a host (safeNext.ts).
  const next = safeNext(String(formData.get('next') ?? ''), '/dashboard');
  // "Keep me signed in on this device", ticked by default (login.html:39).
  // An unticked box submits nothing.
  const remember = formData.get('remember') !== null;

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(rememberedCookies(await cookies(), remember));
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
    return WRONG_CREDENTIALS;
  }

  // app_metadata ONLY — user_metadata is writable by the user from the
  // browser, so reading it here would be a self-service role change. An
  // allow-list: a missing role is not this app either.
  if (data.user?.app_metadata?.['role'] !== 'admin') {
    console.error('[sign-in] wrong app for this account', {
      role: data.user?.app_metadata?.['role'] ?? null,
    });
    // 'local' clears the cookies this call just wrote and nothing more: a
    // client who typed their portal password into the wrong app keeps
    // their genuine Client Portal sessions elsewhere.
    await supabase.auth.signOut({ scope: 'local' });
    return WRONG_CREDENTIALS;
  }

  redirect(next);
}
