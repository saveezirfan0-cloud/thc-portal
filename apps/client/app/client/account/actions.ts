'use server';

import { cookies } from 'next/headers';
import { createClient as createStatelessClient } from '@supabase/supabase-js';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';
import { PASSWORD_COPY } from './copy';

/**
 * Change password on "Your account" (ADR-0051).
 *
 * The one input on the page. It changes how the customer signs in, not any
 * business data, which is why it sits beside §11.1's "Read-only — no
 * editing whatsoever" rather than against it (ADR-0051).
 *
 * The order matters:
 *
 *   1. The rules first, with the function /reset uses (@thc/domain
 *      password.ts), so both forms accept and refuse the same passwords.
 *   2. One attempt is claimed AND counted in a single database call,
 *      password_check_begin() (20261012120200): 5 counted attempts per
 *      account in 15 minutes, then refused before signInWithPassword runs.
 *      Claimed first, so parallel POSTs cannot all read "allowed" (the old
 *      check-then-record race). Fail closed if it cannot be read.
 *   3. The current password is re-verified against the email of the
 *      SESSION (auth.getUser), never an email from the form, on a
 *      throwaway, cookie-less client (`verifier`). Only Supabase's
 *      "invalid credentials" answer leaves the attempt counted; anything
 *      else (its own rate limit, a network error, a 400 for another reason)
 *      releases it.
 *   4. The verifier's session is brand new, and that is why the change runs
 *      on it: with `secure_password_change` on, Supabase refuses a password
 *      change from a session more than 24 hours old without a reauth code,
 *      so updateUser on a month-old device session failed for everybody
 *      who ticked "Keep me signed in". The device ADOPTS the verifier's
 *      session first (setSession through the cookie-bound client, so the
 *      "keep me signed in" choice is honoured, ADR-0032): the change then
 *      ends every OTHER session — the device's old one included — and the
 *      device stays signed in on the new one. If adopting fails, nothing
 *      has changed.
 *   5. Every other device is signed out explicitly, from the new session.
 *      If that call fails the password HAS changed, so the result is
 *      `ok: true` with `tone: 'warning'` and a message that does not claim
 *      the other devices are signed out.
 *
 * `round` counts successful changes. The form keys its fields on it, so a
 * success clears them and a refusal keeps what was typed.
 *
 * Supabase's own error text never reaches the customer: every outcome is
 * one of PASSWORD_COPY's sentences, and the detail goes to the server log.
 */
export interface ChangePasswordState {
  ok: boolean;
  message: string;
  round: number;
  /**
   * 'warning' on a success that needs the customer's attention: the
   * password changed but the other devices could not be signed out. The
   * form shows it amber rather than green. Absent otherwise.
   */
  tone?: 'warning';
}

interface AuthErrorLike {
  status?: number;
  code?: string;
  message: string;
}

/** Supabase's answer to a wrong password, and nothing else. */
function isWrongPassword(error: AuthErrorLike): boolean {
  return error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message);
}

/**
 * password_check_begin / _release are newer than packages/db's generated
 * types (regenerated with `pnpm --filter @thc/db gen:types` against a live
 * project); 787_password_check_begin holds their real signatures.
 */
interface AttemptRpc {
  rpc(
    fn: 'password_check_begin' | 'password_check_release',
    args?: { p_attempt: number },
  ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === 'over_request_rate_limit';
}

export async function changePassword(
  prev: ChangePasswordState | null,
  formData: FormData,
): Promise<ChangePasswordState> {
  const round = prev?.round ?? 0;
  const fail = (message: string): ChangePasswordState => ({ ok: false, message, round });

  const current = String(formData.get('current') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!current) return fail(PASSWORD_COPY.currentMissing);

  const checks = checkPassword(password, confirm);
  if (!passwordOk(checks)) return fail(passwordError(checks) ?? PASSWORD_COPY.failed);
  if (password === current) return fail(PASSWORD_COPY.samePassword);

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) return fail(PASSWORD_COPY.noProject);

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return fail(PASSWORD_COPY.signedOut);

  // ---- 2. claim one counted attempt ------------------------------------
  const attempts = supabase as unknown as AttemptRpc;
  const { data: attempt, error: limitError } = await attempts.rpc('password_check_begin');
  if (limitError) {
    console.error('[account] password attempt limit could not be taken', {
      code: limitError.code,
      message: limitError.message,
    });
    return fail(PASSWORD_COPY.failed);
  }
  if (typeof attempt !== 'number' && typeof attempt !== 'string') return fail(PASSWORD_COPY.tooMany);

  const release = async () => {
    const { error } = await attempts.rpc('password_check_release', { p_attempt: Number(attempt) });
    if (error) {
      // Left counted: one slot of five, for fifteen minutes. Fails closed.
      console.error('[account] password attempt could not be released', {
        code: error.code,
        message: error.message,
      });
    }
  };

  // ---- 3. is it really them? -------------------------------------------
  const verifier = createStatelessClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyError) {
    console.error('[account] current password check refused', {
      status: verifyError.status,
      code: verifyError.code,
    });
    if (isWrongPassword(verifyError)) return fail(PASSWORD_COPY.currentWrong);
    await release();
    return fail(isRateLimited(verifyError) ? PASSWORD_COPY.tooMany : PASSWORD_COPY.failed);
  }
  await release();

  const session = verified?.session;
  if (!session?.access_token || !session.refresh_token) {
    console.error('[account] current password check returned no session');
    return fail(PASSWORD_COPY.failed);
  }

  // ---- 4. this device moves to the fresh session, then the change -------
  const { error: adoptError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (adoptError) {
    console.error('[account] device could not take the fresh session', {
      status: adoptError.status,
      code: adoptError.code,
    });
    try {
      await verifier.auth.signOut({ scope: 'local' });
    } catch {
      /* it expires on its own; the password is unchanged */
    }
    return fail(PASSWORD_COPY.failed);
  }

  const { error } = await verifier.auth.updateUser({ password });
  if (error) {
    console.error('[account] password update failed', {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    const reason = error.message.toLowerCase();
    if (error.code === 'same_password') return fail(PASSWORD_COPY.samePassword);
    if (error.code === 'reauthentication_needed') return fail(PASSWORD_COPY.reauth);
    // The same test /reset applies to the same Supabase answer.
    if (error.code === 'weak_password' || reason.includes('weak') || reason.includes('pwned')) {
      return fail(PASSWORD_COPY.breached);
    }
    return fail(PASSWORD_COPY.failed);
  }

  // ---- 5. every other device ------------------------------------------
  // From the new session, which is now this device's: 'others' keeps it.
  const { error: othersError } = await verifier.auth.signOut({ scope: 'others' });
  if (othersError) {
    console.error('[account] sign-out of other devices failed', {
      status: othersError.status,
      code: othersError.code,
    });
    return {
      ok: true,
      message: PASSWORD_COPY.changedOthersKept,
      round: round + 1,
      tone: 'warning',
    };
  }

  return { ok: true, message: PASSWORD_COPY.changed, round: round + 1 };
}
