'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { NAME_CORRECTION_MESSAGES, validateNameCorrection } from '@thc/domain';
import { NAME_CORRECTION_NOTE, nameCorrectionMessage } from './nameCorrection';
import type { NameCorrectionResult } from './nameCorrection';

/**
 * The office's name correction (ADR-0193).
 *
 * `office_correct_name()` is a definer with every check in its own body —
 * admin, not a viewer (read_only), office_can('identity') so owners and
 * managers only, not a removed profile, the passport rule, the reason — and
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
    fn: 'office_correct_name',
    args: { p_staff: string; p_first: string; p_last: string; p_reason: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function correctName(
  staffId: string,
  first: string,
  last: string,
  reason: string,
  current: { first: string; last: string } | null,
): Promise<NameCorrectionResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };

  const checked = validateNameCorrection({ first, last, reason }, current);
  if (!checked.ok) return { ok: false, message: NAME_CORRECTION_MESSAGES[checked.reason] };

  const supabase = createClient(await cookies()) as unknown as CorrectRpc;
  const { error } = await supabase.rpc('office_correct_name', {
    p_staff: staffId,
    p_first: checked.first,
    p_last: checked.last,
    p_reason: checked.reason,
  });
  if (error) return { ok: false, message: nameCorrectionMessage(error.message) };

  revalidatePath(`/staff/${staffId}`);
  revalidatePath(`/onboarding/${staffId}`);
  revalidatePath('/staff');
  revalidatePath('/staff/names');
  revalidatePath('/onboarding');
  return { ok: true, note: NAME_CORRECTION_NOTE };
}
