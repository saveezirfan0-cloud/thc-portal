'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';

export type ResolveResult = { error: string } | { ok: true; warning?: string };

/**
 * `packages/db`'s generated types are still the Phase 0 placeholder, whose
 * `Functions` map is empty, so supabase-js types every RPC's arguments as
 * `undefined` (see apps/office/app/venues/actions.ts for the same note).
 * The argument names have to match 20260930100000_check_in_out_corrections.sql;
 * regenerating with `pnpm --filter @thc/db gen:types` makes this redundant.
 */
interface RpcClient {
  rpc(
    fn: 'resolve_violation',
    args: {
      p_violation: string;
      p_note: string;
      p_actual_finish: string | null;
      p_arrived_at: string | null;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Resolve a violation (§9.5).
 *
 * Every rule lives in `resolve_violation` — the mandatory note, the finish
 * time validated against the check-in and against now, the No-show
 * reclassification that mirrors "Get back" (§3.3). This action exists to
 * carry the RPC's refusal back to the dialog, which stays open with the
 * reason so the manager can correct it on the spot.
 */
export async function resolveViolation(
  violationId: string,
  note: string,
  actualFinishIso: string | null,
  arrivedAtIso: string | null = null,
): Promise<ResolveResult> {
  if (!supabaseConfigured()) {
    return {
      error:
        'This environment has no Supabase project, so violations cannot be resolved (docs/04-setup-github-vercel-supabase.md).',
    };
  }

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('resolve_violation', {
    p_violation: violationId,
    p_note: note,
    p_actual_finish: actualFinishIso,
    // A No-show's "Arrived at (UK time)" (audit D17); null = the press.
    p_arrived_at: arrivedAtIso,
  });

  if (error) return { error: REASONS[error.message] ?? error.message };

  revalidatePath('/checkin');
  // A resolved No-show is the board's Get back (§3.3).
  revalidatePath('/events/[id]', 'page');
  // The same window resolves from the profile's Shifts tab (§9.6).
  revalidatePath('/staff/[id]', 'page');

  const result = data as { payrollExported?: boolean } | null;
  return result?.payrollExported
    ? {
        ok: true,
        warning:
          'This shift has already been included in a payroll export. This change will not add the payment — please notify Finance to pay it.',
      }
    : { ok: true };
}

/** The RPC's errcodes, in the manager's language rather than Postgres's. */
const REASONS: Record<string, string> = {
  note_required: 'A note is required. Explain the outcome before resolving.',
  actual_finish_required:
    'Resolving a No check-out needs the actual finish time. Enter when the worker left.',
  actual_finish_in_future: 'That finish time is in the future. Enter the time they actually left.',
  actual_finish_before_check_in:
    'That finish time is before the worker checked in. Enter the time they actually left.',
  admins_only: 'Only a manager can resolve a violation.',
  arrived_at_required:
    'The shift has ended, so enter when the worker actually arrived (UK time) before resolving.',
  arrived_at_in_future:
    'That arrival time is in the future. Enter when the worker actually arrived.',
  arrived_at_too_early:
    'That arrival time is before check-in opened (30 minutes before the start). Enter when the worker actually arrived.',
  actual_finish_before_arrival:
    'That finish time is before the arrival. Enter the time the worker actually left.',
  finish_already_recorded:
    'This shift already has a finish time. Resolve the No-show without one; the recorded finish stands.',
};
