'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';
import {
  DEFAULT_LANDING,
  codeError,
  explainCodeError,
  landingAfterVerify,
  normaliseCode,
} from '../two-step';
import { readTwoStep } from '../two-step-session';
import { NO_AUTHENTICATOR } from './copy';

/**
 * The code step (ADR-0057): after email + password, a login with a verified
 * authenticator types its 6-digit code here before anything else opens.
 *
 * `challengeAndVerify` upgrades the session to aal2 and writes the new auth
 * cookies through the same "Keep me signed in" wrapper as every other write
 * (ADR-0032) — the preference cookie was set by sign-in, before it sent the
 * browser here. `next` is the same safe path sign-in was given.
 */
export async function verifyTwoStep(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const code = normaliseCode(formData.get('code'));
  const next = landingAfterVerify(safeNextPath(formData.get('next'), DEFAULT_LANDING));

  const invalid = codeError(code);
  if (invalid) return invalid;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return 'Sign-in is not available yet — this environment has no Supabase project.';
  }

  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { user, decision, totp } = await readTwoStep(supabase);
  // No session (it expired, or they signed out in another tab), or not a
  // Back Office login: start again at the form, which says the right thing.
  if (!user || user.app_metadata?.['role'] !== 'admin') redirect('/login');
  // Already through (another tab) or nothing to check: carry on.
  if (decision === 'pass') redirect(next);
  if (!totp) return NO_AUTHENTICATOR;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (error) {
    console.error('[two-step] code refused', { status: error.status, code: error.code });
    return explainCodeError(error);
  }

  redirect(next);
}
