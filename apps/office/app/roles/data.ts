import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { loadPayFloorPence } from '../_lib/payFloor';
import { DEFAULT_PAY_FLOOR_PENCE } from './money';
import type { Role } from './types';
import { readProblem } from '../_lib/dbError';

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
  /** Today's National Living Wage, pence — no base rate below it (ADR-0137). */
  payFloorPence: number;
}

export async function loadRoles(): Promise<RolesPageData> {
  if (!supabaseConfigured()) {
    return {
      roles: [],
      payFloorPence: DEFAULT_PAY_FLOOR_PENCE,
      problem:
        'This environment has no Supabase project, so the roles catalogue cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());
  const [{ data, error }, payFloorPence] = await Promise.all([
    supabase
      .from('role_directory_v')
      .select(
        'id, name, description, pay_rate, holiday_rate, final_rate, rate_card_count, section_count',
      )
      .order('name')
      .returns<Role[]>(),
    loadPayFloorPence(supabase),
  ]);

  if (error) return { roles: [], problem: readProblem(error), payFloorPence };
  return { roles: data ?? [], problem: null, payFloorPence };
}
