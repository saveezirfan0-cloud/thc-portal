'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { safeNext } from './safeNext';

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
  // A path on this origin or the landing route — never a host (safeNext.ts).
  const next = safeNext(String(formData.get('next') ?? ''), '/shifts');

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(await cookies());
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

  redirect(next);
}
