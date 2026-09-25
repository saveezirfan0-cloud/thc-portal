'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { reviewErrorMessage } from '../compliance/messages';

/**
 * The office's buttons on an automated right-to-work check (ADR-0025):
 * "Run check again", "Mark reviewed" and "Download gov.uk report".
 *
 * The two writes go through the MANAGER'S OWN SESSION: rtw_check_request()
 * and rtw_check_mark_reviewed() each refuse a caller who is not an admin
 * (assert_reviewer) and audit the manager by name. The download reads the
 * report's path through the session too — so only a path this manager can
 * see is ever signed — and signs it with the service key for 60 seconds,
 * because the documents bucket is deny-all to every signed-in role.
 */

export type RtwActionResult =
  { ok: true; message?: string; url?: string } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be done. See docs/04-setup-github-vercel-supabase.md.';

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface ReportRead {
  from(table: 'rtw_checks'): {
    select(columns: 'report_path'): {
      eq(
        column: 'id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: { report_path: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

function revalidate(): void {
  revalidatePath('/compliance');
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
}

/** Queue a fresh check of a pending share-code document. */
export async function runRtwCheckAgain(docId: string): Promise<RtwActionResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc('rtw_check_request', { p_doc: docId });
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };
  revalidate();
  return {
    ok: true,
    message:
      'Queued. The gov.uk check runs within 10 minutes; a pass verifies the share code by itself.',
  };
}

/** Clear a needs-review check whose document has already been decided. */
export async function markRtwCheckReviewed(checkId: string): Promise<RtwActionResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc('rtw_check_mark_reviewed', { p_check: checkId });
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };
  revalidate();
  return { ok: true, message: 'Marked reviewed.' };
}

/** A 60-second link to the gov.uk / provider PDF a check stored. */
export async function rtwReportLink(checkId: string): Promise<RtwActionResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };
  // rtw_checks is newer than the generated types (docs/14 §4): read it
  // through a narrow hand-written shape, as the other new tables are.
  const supabase = createClient(await cookies()) as unknown as ReportRead;
  // RLS on rtw_checks is admin_read: anyone else reads no row, so there is
  // nothing to sign.
  const { data, error } = await supabase
    .from('rtw_checks')
    .select('report_path')
    .eq('id', checkId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data?.report_path) return { ok: false, message: 'This check stored no report.' };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      message: 'Set SUPABASE_SERVICE_ROLE_KEY for the Back Office to open reports.',
    };
  }
  const { data: signed, error: signError } = await admin.storage
    .from('documents')
    .createSignedUrl(data.report_path, 60);
  if (signError || !signed) return { ok: false, message: 'Could not open the report.' };
  return { ok: true, url: signed.signedUrl };
}
