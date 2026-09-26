'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import {
  codeError,
  deviceNameError,
  explainCodeError,
  normaliseCode,
  unverifiedTotp,
  verifiedTotp,
} from '../login/two-step';

/**
 * /account — two-step sign-in, on the user's own session (ADR-0051).
 *
 * Everything here is GoTrue's MFA API on the signed-in user's session: no
 * service key, no table of ours. The set-up is two calls a page apart —
 * `enroll` hands back the QR code and the key, and only a correct code from
 * the phone (`challengeAndVerify`) makes the factor count. Removing it asks
 * for a fresh code first; GoTrue itself refuses to unenroll a verified
 * factor from a session below aal2.
 */

export type TwoStepResult = { ok: true; message?: string } | { ok: false; message: string };

export type TwoStepSetup =
  { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so two-step sign-in cannot be set up here. See docs/04-setup-github-vercel-supabase.md.';
const SESSION_ENDED = 'Your session has ended. Sign in again.';

/** The name the authenticator app shows above the code. */
const ISSUER = 'THC Back Office';

async function session(): Promise<SupabaseClient> {
  return createClient(await cookies()) as unknown as SupabaseClient;
}

/**
 * Step 1: ask GoTrue for a new authenticator secret. A set-up that was
 * started and abandoned is cleared first — GoTrue refuses a second factor
 * with the same name, and an unverified factor protects nothing.
 */
export async function startTwoStepSetup(deviceName: string): Promise<TwoStepSetup> {
  const invalid = deviceNameError(deviceName);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = await session();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: SESSION_ENDED };
  if (verifiedTotp(user.factors)) {
    return { ok: false, message: 'Two-step sign-in is already on for your login.' };
  }

  for (const stale of unverifiedTotp(user.factors)) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: deviceName.trim(),
    issuer: ISSUER,
  });
  if (error || !data) {
    console.error('[two-step] enroll failed', { status: error?.status, code: error?.code });
    return {
      ok: false,
      message:
        error?.code === 'mfa_factor_name_conflict'
          ? 'That name is already used on your login. Choose another.'
          : explainCodeError(error ?? {}),
    };
  }
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Step 2: the first code from the phone. Only now is two-step on. */
export async function confirmTwoStepSetup(input: {
  factorId: string;
  code: string;
}): Promise<TwoStepResult> {
  const code = normaliseCode(input.code);
  const invalid = codeError(code);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = await session();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: input.factorId,
    code,
  });
  if (error) {
    console.error('[two-step] set-up code refused', { status: error.status, code: error.code });
    return { ok: false, message: explainCodeError(error) };
  }
  revalidatePath('/account');
  return {
    ok: true,
    message:
      'Two-step sign-in is on. Next time you sign in, you will be asked for a code from your phone after your password.',
  };
}

/**
 * "Cancel" during set-up. Only ever removes a factor that was never
 * verified — this is not a way round the fresh code that Remove asks for.
 */
export async function cancelTwoStepSetup(factorId: string): Promise<TwoStepResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await session();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: SESSION_ENDED };
  const pending = unverifiedTotp(user.factors).find((f) => f.id === factorId);
  if (pending) await supabase.auth.mfa.unenroll({ factorId: pending.id });
  return { ok: true };
}

/**
 * Turn it off. A fresh code proves the phone is in the hand of the person
 * asking — a session left open on a shared computer is not enough.
 */
export async function removeTwoStep(rawCode: string): Promise<TwoStepResult> {
  const code = normaliseCode(rawCode);
  const invalid = codeError(code);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = await session();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: SESSION_ENDED };
  const totp = verifiedTotp(user.factors);
  if (!totp) return { ok: true, message: 'Two-step sign-in was already off.' };

  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (verified.error) {
    console.error('[two-step] removal code refused', {
      status: verified.error.status,
      code: verified.error.code,
    });
    return { ok: false, message: explainCodeError(verified.error) };
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: totp.id });
  if (error) {
    console.error('[two-step] unenroll failed', { status: error.status, code: error.code });
    return { ok: false, message: 'Two-step sign-in could not be switched off. Try again.' };
  }
  revalidatePath('/account');
  return {
    ok: true,
    message:
      'Two-step sign-in is off. You will sign in with your password only. You can delete “THC Back Office” from your authenticator app.',
  };
}
