'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { reviewErrorMessage } from '../compliance/messages';
import { signStaffPhotos } from './photos';

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
 *
 * "Compare the photos" (ADR-0041): the admin sets the applicant photo
 * gov.uk showed beside the worker's app selfie before pressing Verify. The
 * caller is checked to be an admin first; both paths are read through the
 * session (never taken from the browser); the gov.uk photo is signed with
 * the service key for 60 seconds, the selfie through the session
 * (_lib/photos.ts).
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

const NOT_AUTHORISED = 'Only the office can compare right-to-work photos.';

/** Long enough to draw the image, short enough not to be worth forwarding. */
const GOV_PHOTO_TTL_SECONDS = 60;

/** True only for a signed-in admin (§1.4), read through the session. */
async function callerIsAdmin(): Promise<boolean> {
  try {
    const supabase = createClient(await cookies());
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .maybeSingle<{ role: string }>();
    return profile?.role === 'admin';
  } catch {
    return false;
  }
}

interface MaybeOne<T> {
  maybeSingle(): PromiseLike<{ data: T | null; error: { message: string } | null }>;
}

/** rtw_checks_latest_v and staff_profile_v are newer than the generated types (docs/14 §4). */
interface PhotoRead {
  from(table: 'rtw_checks_latest_v'): {
    select(columns: 'staff_id, status, photo_path'): {
      eq(
        column: 'check_id',
        value: string,
      ): MaybeOne<{ staff_id: string; status: string; photo_path: string | null }>;
    };
  };
  from(table: 'staff_profile_v'): {
    select(columns: 'photo_path'): {
      eq(column: 'id', value: string): MaybeOne<{ photo_path: string | null }>;
    };
  };
}

export type RtwPhotosResult =
  | {
      ok: true;
      govPhotoUrl: string | null;
      selfieUrl: string | null;
      /** Whether gov.uk's photo was captured at all (false: none to sign). */
      hasGovPhoto: boolean;
      /** Whether the worker has a selfie on file at all. */
      hasSelfie: boolean;
    }
  | { ok: false; message: string };

/**
 * The gov.uk photo and the worker's app selfie for one check, as
 * short-lived signed URLs. Either may be null — no photo captured, no
 * selfie yet, or it could not be signed — and the panel says so plainly
 * rather than failing.
 */
export async function rtwCheckPhotos(checkId: string): Promise<RtwPhotosResult> {
  if (!configured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await callerIsAdmin())) return { ok: false, message: NOT_AUTHORISED };

  const supabase = createClient(await cookies()) as unknown as PhotoRead;
  // The view is security_invoker over the admin-read table: a row read here
  // is one this admin may see, so its path is one they may have signed.
  const { data: check, error } = await supabase
    .from('rtw_checks_latest_v')
    .select('staff_id, status, photo_path')
    .eq('check_id', checkId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!check) return { ok: false, message: 'This is no longer the latest gov.uk check.' };

  const { data: staff } = await supabase
    .from('staff_profile_v')
    .select('photo_path')
    .eq('id', check.staff_id)
    .maybeSingle();
  const selfiePath = staff?.photo_path ?? null;
  const selfieUrl = selfiePath
    ? ((await signStaffPhotos([selfiePath])).get(selfiePath) ?? null)
    : null;

  // Only a finished check's photo is the one being confirmed: a running
  // check may still be filing it.
  let govPhotoUrl: string | null = null;
  const govPhotoPath =
    check.status === 'needs_review' || check.status === 'passed' ? check.photo_path : null;
  if (govPhotoPath) {
    try {
      const { data: signed } = await createAdminClient()
        .storage.from('documents')
        .createSignedUrl(govPhotoPath, GOV_PHOTO_TTL_SECONDS);
      govPhotoUrl = signed?.signedUrl ?? null;
    } catch {
      govPhotoUrl = null;
    }
  }
  return {
    ok: true,
    govPhotoUrl,
    selfieUrl,
    hasGovPhoto: govPhotoPath !== null,
    hasSelfie: selfiePath !== null,
  };
}
