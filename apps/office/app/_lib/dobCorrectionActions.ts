'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { DOB_CORRECTION_MESSAGES, ukToday, validateDobCorrection } from '@thc/domain';
import { dobCorrectionMessage, dobCorrectionOutcome } from './dobCorrection';
import type { DobCorrectionAnswer, DobCorrectionResult } from './dobCorrection';

/**
 * The office's date-of-birth correction (ADR-0069).
 *
 * `office_correct_dob()` is a definer with every check in its own body —
 * admin, not a viewer (read_only), office_can('identity') so owners and
 * managers only, not a removed profile, the date rule, the reason — and
 * `auth.uid()` as the actor. So it is called through the MANAGER'S OWN
 * SESSION, never the service key: the audit row names the manager without
 * anything being passed in, and there is no service-role door to guard.
 *
 * The domain's check runs first for the manager's sake (the same words the
 * dialog shows); the database checks again.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

interface CorrectRpc {
  rpc(
    fn: 'office_correct_dob',
    args: { p_staff: string; p_dob: string; p_reason: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function correctDob(
  staffId: string,
  dob: string,
  reason: string,
  current: string | null,
): Promise<DobCorrectionResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };

  const checked = validateDobCorrection({ dob, reason }, current, ukToday());
  if (!checked.ok) return { ok: false, message: DOB_CORRECTION_MESSAGES[checked.reason] };

  const supabase = createClient(await cookies()) as unknown as CorrectRpc;
  const { data, error } = await supabase.rpc('office_correct_dob', {
    p_staff: staffId,
    p_dob: checked.dob,
    p_reason: checked.reason,
  });
  if (error) return { ok: false, message: dobCorrectionMessage(error.message) };

  revalidatePath(`/staff/${staffId}`);
  revalidatePath(`/onboarding/${staffId}`);
  revalidatePath('/staff');
  revalidatePath('/compliance');
  return { ok: true, ...dobCorrectionOutcome((data ?? null) as DobCorrectionAnswer | null) };
}
