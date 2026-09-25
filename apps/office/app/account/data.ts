import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';

/** The signed-in user's own account, as /account shows it. */
export interface MyAccount {
  email: string;
  /** An address change waiting for its confirmation link to be opened. */
  pendingEmail: string | null;
  fullName: string;
  phone: string;
  jobTitle: string;
  role: string;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AccountPageData {
  account: MyAccount | null;
  problem: string | null;
}

interface ProfileRow {
  full_name: string;
  phone: string | null;
  job_title: string | null;
  role: string;
  created_at: string | null;
}

/**
 * The profile row is the user's own (`profiles_self`, select only); the
 * email and last sign-in come from the session's GoTrue user, which is the
 * authority on both.
 */
export async function loadMyAccount(): Promise<AccountPageData> {
  if (!supabaseConfigured()) {
    return {
      account: null,
      problem:
        'This environment has no Supabase project, so there is no account to show. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { account: null, problem: 'Your session has ended. Sign in again.' };

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, job_title, role, created_at')
    .eq('id', user.id)
    .returns<ProfileRow[]>()
    .maybeSingle();
  if (error) return { account: null, problem: error.message };

  return {
    account: {
      email: user.email ?? '',
      pendingEmail: user.new_email ?? null,
      fullName: data?.full_name ?? '',
      phone: data?.phone ?? '',
      jobTitle: data?.job_title ?? '',
      role: data?.role ?? String(user.app_metadata?.['role'] ?? ''),
      createdAt: data?.created_at ?? user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    },
    problem: data ? null : 'This login has no profile yet, so the details below cannot be saved.',
  };
}
