'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { explainAccountError as explainAccountCode } from '../_lib/accounts';
import { explainOfficeError } from '../_lib/permissions';

/**
 * "Can review criminal records" on /users (ADR-0180): an owner names the
 * Back Office logins that decide criminal declarations. The database is the
 * decision — admin_set_criminal_records_reviewer() refuses anyone but an
 * owner, anything but an office login, and a viewer, and writes the audit
 * row — through the owner's own session.
 */
export type CriminalRecordsResult = { ok: true; message: string } | { ok: false; message: string };

const REFUSALS: Record<string, string> = {
  viewer_cannot_review:
    'A viewer cannot be allowed to review criminal records: their role changes nothing. Change their role first.',
  not_office_login: 'Only a Back Office login can review criminal records.',
};

export async function setCriminalRecordsReviewer(
  userId: string,
  on: boolean,
): Promise<CriminalRecordsResult> {
  if (!supabaseConfigured()) {
    return {
      ok: false,
      message:
        'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as {
    rpc(
      fn: string,
      args: Record<string, string | boolean>,
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc('admin_set_criminal_records_reviewer', {
    p_user: userId,
    p_on: on,
  });
  if (error) {
    const code = error.message.split(':')[0]?.trim() ?? '';
    return {
      ok: false,
      message:
        REFUSALS[code] ?? explainOfficeError(error.message) ?? explainAccountCode(error.message),
    };
  }
  revalidatePath('/users');
  revalidatePath('/activity');
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  if (!changed) return { ok: true, message: 'No change.' };
  return {
    ok: true,
    message: on
      ? 'They can now decide criminal declarations.'
      : 'They can no longer decide criminal declarations.',
  };
}
