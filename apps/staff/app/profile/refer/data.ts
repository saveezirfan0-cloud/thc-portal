import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../../db';
import type { Found } from '../../data';

/**
 * The two reads behind /profile/refer (ADR-0047): the worker's code,
 * minted the first time (`my_referral_code()`), and the count of people
 * who applied with it (`my_referral_summary()`) — a number, never names.
 *
 * Each carries its own failure (audit D18). A failed count is not "No one
 * yet": a worker whose friends did apply would be told nobody had. A failed
 * code is not "no link": the screen says it could not load, with the retry.
 */
export interface ReferralRead {
  code: Found<string>;
  applied: Found<number>;
}

/** The two RPCs, typed locally until the Phase 2 type regeneration. */
interface ReferralRpc {
  rpc(
    fn: 'my_referral_code' | 'my_referral_summary',
    args: Record<string, never>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function loadReferral(): Promise<ReferralRead> {
  if (!supabaseConfigured()) {
    return { code: { row: null, problem: null }, applied: { row: null, problem: null } };
  }
  const supabase = staffDb(await cookies()) as unknown as ReferralRpc;
  const [minted, summary] = await Promise.all([
    supabase.rpc('my_referral_code', {}),
    supabase.rpc('my_referral_summary', {}),
  ]);
  return {
    code: minted.error
      ? { row: null, problem: minted.error.message || 'my_referral_code failed' }
      : { row: typeof minted.data === 'string' ? minted.data : null, problem: null },
    applied: summary.error
      ? { row: null, problem: summary.error.message || 'my_referral_summary failed' }
      : {
          row: Number((summary.data as { applied?: number } | null)?.applied ?? 0),
          problem: null,
        },
  };
}
