'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@thc/db';
import {
  authAttemptAllowed,
  callerIp,
  isCredentialFailure,
  recordAuthAttempt,
  signInKeys,
} from '@thc/db/auth-throttle';
import { createClient } from '@thc/db/server';
import { clearTimeFormatCookie } from '@thc/db/time-format';

/**
 * Email + password sign-in (§1.4).
 *
 * The failure message never distinguishes a wrong email from a wrong
 * password: saying which one is wrong tells an attacker whether an account
 * exists. The wireframes word it that way deliberately.
 */
const SIGN_IN_REFUSED = 'Email or password is incorrect. Try again or reset your password.';

export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // Only ever a path on this app (§1.4): see packages/db/src/redirect.ts.
  const next = safeNextPath(formData.get('next'), '/shifts');

  if (!email || !password) return 'Enter your email and password.';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  // Per account and per address (packages/db/src/auth-throttle.ts): five
  // wrong passwords in 15 minutes and the next try is not even put to
  // GoTrue. Refused with the SAME words as a wrong password, so the limit
  // says nothing about whether the account exists.
  const keys = await signInKeys(email, callerIp(await headers()));
  if (!(await authAttemptAllowed('sign_in', keys))) return SIGN_IN_REFUSED;

  const store = await cookies();
  const supabase = createClient(store);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (isCredentialFailure(error)) await recordAuthAttempt('sign_in', keys, true);
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

  // ADR-0085: a session that ended without a sign-out (expiry) can leave the
  // last person's clock on this device; the next page reads this login's own.
  clearTimeFormatCookie(store);
  redirect(next);
}
