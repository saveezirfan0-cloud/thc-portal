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
 *   2. The current password is re-verified here, server-side, against the
 *      email of the SESSION (auth.getUser), never an email from the form: a
 *      left-open laptop must not be enough to lock the real person out.
 *      The check runs on a throwaway, cookie-less client, so it cannot
 *      overwrite this device's session cookies or its "keep me signed in"
 *      choice (ADR-0032), and the extra session it creates is ended at once.
 *      It is throttled per ACCOUNT first (security review L2,
 *      20261001100200): 5 wrong current passwords in 15 minutes and the
 *      action refuses without calling signInWithPassword. Every attempt
 *      leaves from Vercel's addresses, so Supabase's per-IP limit would
 *      never bind somebody guessing from a left-open session, and would
 *      lock out every other portal user instead.
 *   3. updateUser on the caller's OWN session. Running it on the check's
 *      session instead would make Supabase treat that one as "current" and
 *      sign this device out.
 *   4. Every other device is signed out, as /reset does.
 *
 * `round` counts successful changes. The form keys its fields on it, so a
 * success clears them and a refusal keeps what was typed.
 */
export interface ChangePasswordState {
  ok: boolean;
  message: string;
  round: number;
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

  // ---- 2. is it really them? -------------------------------------------
  // The per-account limit comes first, on the caller's own session. If it
  // cannot be read, fail closed: no answer is not a "yes".
  const { data: allowed, error: limitError } = await supabase.rpc('password_check_allowed');
  if (limitError) {
    console.error('[account] password attempt limit could not be read', {
      code: limitError.code,
      message: limitError.message,
    });
    return fail(PASSWORD_COPY.failed);
  }
  if (allowed !== true) return fail(PASSWORD_COPY.tooMany);

  const verifier = createStatelessClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyError) {
    console.error('[account] current password check refused', {
      status: verifyError.status,
      code: verifyError.code,
    });
    if (verifyError.status === 429 || verifyError.code === 'over_request_rate_limit') {
      return fail(PASSWORD_COPY.tooMany);
    }
    if (verifyError.code === 'invalid_credentials' || verifyError.status === 400) {
      // Only a wrong password counts towards the limit — never Supabase's
      // own rate limit (above) or a network failure (below).
      const { error: recordError } = await supabase.rpc('record_password_check_failure');
      if (recordError) {
        console.error('[account] failed password check could not be recorded', {
          code: recordError.code,
          message: recordError.message,
        });
      }
      return fail(PASSWORD_COPY.currentWrong);
    }
    return fail(PASSWORD_COPY.failed);
  }
  // The check's own session has done its job. Best effort: step 4 ends it
  // anyway if this call is lost.
  try {
    await verifier.auth.signOut({ scope: 'local' });
  } catch {
    /* step 4 covers it */
  }

  // ---- 3. the change itself, on this device's session -------------------
  const { error } = await supabase.auth.updateUser({ password });
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
    if (reason.includes('weak') || reason.includes('pwned')) return fail(PASSWORD_COPY.breached);
    return fail(PASSWORD_COPY.failed);
  }

  // ---- 4. every other device --------------------------------------------
  // The password has changed either way, so this is still a success — but
  // the message must not claim the other devices are signed out when they
  // are not (security review, 29.09).
  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' });
  if (othersError) {
    console.error('[account] sign-out of other devices failed', {
      status: othersError.status,
      code: othersError.code,
    });
    return { ok: true, message: PASSWORD_COPY.changedOthersKept, round: round + 1 };
  }

  return { ok: true, message: PASSWORD_COPY.changed, round: round + 1 };
}
