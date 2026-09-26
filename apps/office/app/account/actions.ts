'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkPassword, passwordError, passwordOk } from '@thc/domain';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { appOrigin } from '@thc/db';
import {
  explainAccountError,
  normaliseEmail,
  validateEmail,
  validateJobTitle,
  validateName,
  validatePhone,
} from '../_lib/accounts';

/**
 * /account — the signed-in user's own profile (ADR-0055).
 *
 * The details go through `update_my_profile` (20261001200000): `profiles`
 * has no UPDATE policy, so that function is the only way in, and it
 * writes the audit row. Email and password are GoTrue's, changed on the
 * user's own session — never the service key.
 */

export type AccountResult = { ok: true; message?: string } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

function session(store: Awaited<ReturnType<typeof cookies>>): SupabaseClient {
  return createClient(store) as unknown as SupabaseClient;
}

export async function saveMyDetails(input: {
  fullName: string;
  phone: string;
  jobTitle: string;
}): Promise<AccountResult> {
  const invalid =
    validateName(input.fullName) ?? validatePhone(input.phone) ?? validateJobTitle(input.jobTitle);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = session(await cookies());
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_full_name: input.fullName.trim(),
    p_phone: input.phone.trim() || null,
    p_job_title: input.jobTitle.trim() || null,
  });
  if (error) return { ok: false, message: explainAccountError(error.message) };

  // The sidebar foot names the user on every page, from the root layout.
  revalidatePath('/', 'layout');
  const changed = (data as { changed?: string[] } | null)?.changed ?? [];
  return { ok: true, message: changed.length === 0 ? 'Nothing had changed.' : 'Saved.' };
}

/**
 * GoTrue sends a confirmation link (to both addresses when "secure email
 * change" is on, which is the Supabase default); the address changes only
 * when it is opened. Until then the old address still signs in.
 */
export async function changeMyEmail(newEmail: string): Promise<AccountResult> {
  const email = normaliseEmail(newEmail);
  const invalid = validateEmail(email);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = session(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, message: 'Your session has ended. Sign in again.' };
  if (normaliseEmail(auth.user.email ?? '') === email) {
    return { ok: false, message: 'That is already your sign-in address.' };
  }

  // The Back Office's own public URL (packages/db origin.ts): never guessed
  // in production, so an unset variable is refused in words.
  const origin = appOrigin(process.env['NEXT_PUBLIC_OFFICE_URL'], 'http://127.0.0.1:3000');
  if (!origin) {
    return {
      ok: false,
      message: 'The email cannot be changed on this deployment yet — set NEXT_PUBLIC_OFFICE_URL.',
    };
  }
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/callback?next=/account` },
  );
  if (error) {
    console.error('[account] email change failed', {
      status: error.status,
      message: error.message,
    });
    return {
      ok: false,
      message: /already|registered|exists/i.test(error.message)
        ? 'That address already has a login.'
        : 'The address could not be changed. Try again in a minute.',
    };
  }
  revalidatePath('/account');
  return {
    ok: true,
    message: `Check ${email} for a confirmation link. Your current address keeps working until it is opened.`,
  };
}

/**
 * The current password is checked on a separate, cookie-less client, so a
 * wrong guess cannot disturb the session this action runs on. Every other
 * device is signed out afterwards, as a reset does (§10.2).
 */
export async function changeMyPassword(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<AccountResult> {
  const checks = checkPassword(input.next, input.confirm);
  if (!passwordOk(checks))
    return { ok: false, message: passwordError(checks) ?? 'Check the new password.' };
  if (!input.current) return { ok: false, message: 'Enter your current password.' };
  if (input.current === input.next) {
    return { ok: false, message: 'The new password must be different from the current one.' };
  }
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = session(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  const email = auth?.user?.email;
  if (!email) return { ok: false, message: 'Your session has ended. Sign in again.' };

  const probe = createSupabaseClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const check = await probe.auth.signInWithPassword({ email, password: input.current });
  if (check.error) return { ok: false, message: 'Your current password is not right.' };
  await probe.auth.signOut({ scope: 'local' });

  const { error } = await supabase.auth.updateUser({ password: input.next });
  if (error) {
    console.error('[account] password change failed', {
      status: error.status,
      message: error.message,
    });
    return {
      ok: false,
      message: /weak|pwned/i.test(error.message)
        ? 'That password has appeared in a known data breach. Choose a different one.'
        : 'The password could not be changed. Try again.',
    };
  }
  await supabase.auth.signOut({ scope: 'others' });
  return { ok: true, message: 'Password changed. Every other device has been signed out.' };
}

/** A lost phone or a shared laptop: end every session but this one. */
export async function signOutOtherDevices(): Promise<AccountResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = session(await cookies());
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) return { ok: false, message: 'That did not work. Try again.' };
  return { ok: true, message: 'Every other device has been signed out.' };
}
