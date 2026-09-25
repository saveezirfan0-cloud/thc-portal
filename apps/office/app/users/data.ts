import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';

/** One login, as `admin_accounts()` (20260930100000) returns it. */
export interface AccountRow {
  id: string;
  email: string | null;
  role: 'admin' | 'client' | 'staff';
  full_name: string;
  phone: string | null;
  job_title: string | null;
  client_id: string | null;
  client_name: string | null;
  staff_id: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  disabled: boolean;
}

export interface UsersPageData {
  accounts: AccountRow[];
  clients: { id: string; name: string }[];
  /** The signed-in manager: they cannot switch themselves off. */
  selfId: string | null;
  problem: string | null;
}

export async function loadUsers(): Promise<UsersPageData> {
  if (!supabaseConfigured()) {
    return {
      accounts: [],
      clients: [],
      selfId: null,
      problem:
        'This environment has no Supabase project, so there are no logins to list. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const [{ data: auth }, accounts, clients] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('admin_accounts'),
    supabase
      .from('clients')
      .select('id, name')
      .order('name')
      .returns<{ id: string; name: string }[]>(),
  ]);
  return {
    accounts: (accounts.data ?? []) as AccountRow[],
    clients: clients.data ?? [],
    selfId: auth?.user?.id ?? null,
    problem: accounts.error?.message ?? clients.error?.message ?? null,
  };
}
