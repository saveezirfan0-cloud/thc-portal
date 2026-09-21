import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { Role } from './types';

/**
 * Reads for /roles (§9.8).
 *
 * `roles` carries `pay_rate`, so it is money: admin_all is the only policy
 * on it, and `role_directory_v` is security_invoker, so neither a client nor
 * a worker reaches it (§11.1).
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface RolesPageData {
  roles: Role[];
  problem: string | null;
}

export async function loadRoles(): Promise<RolesPageData> {
  if (!supabaseConfigured()) {
    return {
      roles: [],
      problem:
        'This environment has no Supabase project, so the roles catalogue cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('role_directory_v')
    .select(
      'id, name, description, pay_rate, holiday_rate, final_rate, rate_card_count, section_count',
    )
    .order('name')
    .returns<Role[]>();

  if (error) return { roles: [], problem: error.message };
  return { roles: data ?? [], problem: null };
}
