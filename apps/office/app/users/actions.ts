'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@thc/db/admin';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { officeOrigin } from '../login/origin';
import {
  explainAccountError,
  normaliseEmail,
  validateEmail,
  validateJobTitle,
  validateName,
} from '../_lib/accounts';
import {
  type InviteAdmin,
  type InviteRole,
  type LoginLookup,
  inviteLink,
  mintLogin,
  refuseBeforeMint,
} from './invite';
import type { AccountRow } from './data';

/**
 * /users — Users & access (ADR-0035).
 *
 * Every write is the database's decision, made as the signed-in manager:
 * `admin_register_account` and `admin_set_login_disabled` check the role
 * themselves and write the audit row. The service key is used for ONE
 * thing — minting the login and its one-time token through GoTrue — and
 * only after this file has checked the caller is an admin.
 */

export type UsersResult =
  { ok: true; message?: string; link?: string; email?: string } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';
const SERVICE_KEY =
  'The login could not be created — set SUPABASE_SERVICE_ROLE_KEY for the Back Office.';

function session(store: Awaited<ReturnType<typeof cookies>>): SupabaseClient {
  return createClient(store) as unknown as SupabaseClient;
}

async function asAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .maybeSingle<{ role: string }>();
  return profile?.role === 'admin';
}

/**
 * The app a login is for. The Client Portal is its own deployment, so its
 * origin is configuration — the variable its own password reset reads.
 */
function originFor(role: InviteRole): string | null {
  if (role === 'admin') return officeOrigin();
  const explicit = process.env['NEXT_PUBLIC_CLIENT_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return null;
  return 'http://127.0.0.1:3002';
}

async function issue(
  supabase: SupabaseClient,
  input: {
    email: string;
    role: InviteRole;
    fullName: string;
    clientId: string | null;
    jobTitle: string | null;
  },
): Promise<UsersResult> {
  const origin = originFor(input.role);
  if (!origin) {
    return {
      ok: false,
      message:
        'The invite link could not be built — set NEXT_PUBLIC_CLIENT_URL for the Back Office.',
    };
  }

  const lookup = await supabase.rpc('admin_login_lookup', { p_email: input.email });
  if (lookup.error) return { ok: false, message: explainAccountError(lookup.error.message) };
  const refusal = refuseBeforeMint(
    (lookup.data ?? { exists: false }) as LoginLookup,
    input.role,
    input.clientId,
  );
  if (refusal) return { ok: false, message: explainAccountError(refusal) };

  let admin: InviteAdmin;
  try {
    admin = createAdminClient().auth.admin as unknown as InviteAdmin;
  } catch {
    return { ok: false, message: SERVICE_KEY };
  }

  const minted = await mintLogin(admin, input.email, input.role);
  if (!minted.ok) {
    if (minted.detail)
      console.error('[users] login mint failed', { code: minted.code, detail: minted.detail });
    return {
      ok: false,
      message:
        minted.code === 'account_has_other_role'
          ? explainAccountError('account_has_other_role')
          : 'The invite link could not be created. Try again in a minute.',
    };
  }

  const { error } = await supabase.rpc('admin_register_account', {
    p_user: minted.userId,
    p_role: input.role,
    p_full_name: input.fullName,
    p_client: input.clientId,
    p_job_title: input.jobTitle,
  });
  if (error) return { ok: false, message: explainAccountError(error.message) };

  revalidatePath('/users');
  revalidatePath('/activity');
  return {
    ok: true,
    email: input.email,
    link: inviteLink(origin, minted.tokenHash, minted.type),
  };
}

export async function inviteUser(input: {
  email: string;
  fullName: string;
  role: InviteRole;
  clientId: string;
  jobTitle: string;
}): Promise<UsersResult> {
  const email = normaliseEmail(input.email);
  const invalid =
    validateName(input.fullName) ??
    validateEmail(email) ??
    (input.role === 'admin' ? validateJobTitle(input.jobTitle) : null) ??
    (input.role === 'client' && !input.clientId ? 'Pick the client this login belongs to.' : null);
  if (invalid) return { ok: false, message: invalid };
  if (input.role !== 'admin' && input.role !== 'client') {
    return { ok: false, message: explainAccountError('role_not_allowed') };
  }
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = session(await cookies());
  if (!(await asAdmin(supabase)))
    return { ok: false, message: explainAccountError('not_authorised') };

  return issue(supabase, {
    email,
    role: input.role,
    fullName: input.fullName.trim(),
    clientId: input.role === 'client' ? input.clientId : null,
    jobTitle: input.role === 'admin' ? input.jobTitle.trim() || null : null,
  });
}

/**
 * A fresh set-up link for an existing office or client login: the first
 * one expired, or they lost their password. Minting replaces the token in
 * any earlier link, which is the point.
 */
export async function newInviteLink(userId: string): Promise<UsersResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = session(await cookies());
  if (!(await asAdmin(supabase)))
    return { ok: false, message: explainAccountError('not_authorised') };

  const { data, error } = await supabase.rpc('admin_accounts');
  if (error) return { ok: false, message: explainAccountError(error.message) };
  const row = ((data ?? []) as AccountRow[]).find((account) => account.id === userId);
  if (!row || !row.email) return { ok: false, message: explainAccountError('unknown_account') };
  if (row.role === 'staff') return { ok: false, message: explainAccountError('role_not_allowed') };
  if (row.disabled) {
    return {
      ok: false,
      message: 'This login is switched off. Switch it on before sending a new link.',
    };
  }

  return issue(supabase, {
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    clientId: row.client_id,
    jobTitle: row.job_title,
  });
}

export async function setLoginDisabled(
  userId: string,
  disabled: boolean,
  reason: string,
): Promise<UsersResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = session(await cookies());
  const { error } = await supabase.rpc('admin_set_login_disabled', {
    p_user: userId,
    p_disabled: disabled,
    p_reason: reason.trim() || null,
  });
  if (error) return { ok: false, message: explainAccountError(error.message) };
  revalidatePath('/users');
  revalidatePath('/activity');
  return {
    ok: true,
    message: disabled ? 'Switched off. Their sessions have ended.' : 'Switched back on.',
  };
}
