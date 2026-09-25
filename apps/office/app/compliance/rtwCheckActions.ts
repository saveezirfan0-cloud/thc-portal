'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@thc/db/admin';
import { createClient } from '@thc/db/server';
import { callerIsAdmin, signStaffPhotos } from '../_lib/photos';
import { supabaseConfigured } from './data';
import { rerunErrorMessage, rerunMessage } from './rtwCheck';
import type { RerunResult } from './rtwCheck';

/**
 * The gov.uk share-code check's two office actions (ADR-0025): "Run check
 * again" and the photo comparison. Shared by /onboarding/:id, the staff
 * profile's Documents tab and /compliance.
 *
 * Both check the caller is an office admin through the SESSION first
 * (defence in depth — the database checks again). Nothing here takes a
 * storage path from the browser: the photo paths are read through the
 * session client, so only a row this admin can see is ever signed, and the
 * signed URLs are short-lived.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be done. See docs/04-setup-github-vercel-supabase.md.';
const NOT_AUTHORISED = 'Only the office can run the gov.uk check.';

/** Long enough to draw two images, short enough not to be worth forwarding. */
const GOV_PHOTO_TTL_SECONDS = 60;

interface RerunRpc {
  rpc(
    fn: 'rerun_rtw_check',
    args: { p_document: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** "Run check again" — admin only, pending share code reports only (rerun_rtw_check). */
export async function rerunRtwCheck(docId: string): Promise<RerunResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await callerIsAdmin())) return { ok: false, message: NOT_AUTHORISED };

  const supabase = createClient(await cookies()) as unknown as RerunRpc;
  const { data, error } = await supabase.rpc('rerun_rtw_check', { p_document: docId });
  if (error) return { ok: false, message: rerunErrorMessage(error.message) };
  const result = rerunMessage(data);
  if (result.ok) {
    revalidatePath('/compliance');
    revalidatePath('/onboarding', 'layout');
    revalidatePath('/staff', 'layout');
  }
  return result;
}

interface CheckPhotoRow {
  staff_id: string;
  status: string;
  photo_path: string | null;
}

interface CheckPhotoClient {
  from(table: 'rtw_checks'): {
    select(columns: string): {
      eq(
        column: 'document_id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: CheckPhotoRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export type RtwPhotos =
  | { ok: true; govPhotoUrl: string | null; selfieUrl: string | null }
  | { ok: false; message: string };

/**
 * The gov.uk photo next to the worker's app selfie, for the reviewer to
 * compare before verifying. Either may be null (no photo on the result, no
 * selfie yet, or it could not be signed); the screen says so rather than
 * failing.
 */
export async function rtwCheckPhotos(docId: string): Promise<RtwPhotos> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await callerIsAdmin())) return { ok: false, message: NOT_AUTHORISED };

  const supabase = createClient(await cookies());
  const { data: check, error } = await (supabase as unknown as CheckPhotoClient)
    .from('rtw_checks')
    .select('staff_id, status, photo_path')
    .eq('document_id', docId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!check) return { ok: false, message: 'There is no gov.uk check on this document.' };

  const { data: staff } = await supabase
    .from('staff_profile_v')
    .select('photo_path')
    .eq('id', check.staff_id)
    .maybeSingle<{ photo_path: string | null }>();
  const selfiePath = staff?.photo_path ?? null;
  const selfieUrl = selfiePath
    ? ((await signStaffPhotos([selfiePath])).get(selfiePath) ?? null)
    : null;

  // A re-queued check keeps its old paths until the new result lands; only
  // a finished check's photo is the one being confirmed.
  let govPhotoUrl: string | null = null;
  if (check.status === 'done' && check.photo_path) {
    try {
      const { data: signed } = await createAdminClient()
        .storage.from('documents')
        .createSignedUrl(check.photo_path, GOV_PHOTO_TTL_SECONDS);
      govPhotoUrl = signed?.signedUrl ?? null;
    } catch {
      govPhotoUrl = null;
    }
  }
  return { ok: true, govPhotoUrl, selfieUrl };
}
