'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@thc/db/admin';
import { DOCUMENT_UPLOAD_REASONS, evidenceFileProblem } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../../../db';
import { photoPathFor } from '../../photos';
import { changeReason } from '../../change-requests';
import type { ActionResult } from '../../types';

/**
 * Request a change — the worker's actions (ADR-0038, 20260930120200).
 *
 * Every rule is `request_profile_change()`'s: one pending per kind, the
 * uploaded object must exist in the worker's own folder, a name equal to
 * the current one is refused, RC1 is queued with the insert. What this file
 * adds is the two upload slots, and neither takes a path from the browser:
 *
 *   evidence  documents/<staff_id>/change-requests/<uuid>.<ext>, through a
 *             one-object signed upload issued with the service key — the
 *             documents bucket has no worker policy (20260922183015) and
 *             gets none. The same route every documents upload takes.
 *   photo     photos/<staff_id>/selfie-<epoch>.jpg, a fresh name uploaded
 *             with the worker's OWN session under photos_worker_insert_own.
 *             The current photo is not touched until the office approves.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';
const TRY_AGAIN = 'That didn’t go through. Please try again.';

async function db() {
  return staffDb(await cookies());
}

/** The caller, from their own session — `staff_me()`, no id to forge. */
async function me(): Promise<{ staffId: string; status: string } | null> {
  const { data } = await (await db()).rpc('staff_me', {});
  const row = data as Record<string, unknown> | null;
  if (!row?.['staffId']) return null;
  return { staffId: row['staffId'] as string, status: row['status'] as string };
}

/** The statuses `request_profile_change()` accepts; asked here only to fail early. */
const MAY_REQUEST = new Set(['compliant', 'blocked']);

export type UploadSlot = { ok: true; path: string; token: string } | { ok: false; message: string };

/** A one-object signed upload for name-change evidence (Q13). */
export async function startEvidenceUpload(file: {
  name: string;
  type: string;
  size: number;
}): Promise<UploadSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const problem = evidenceFileProblem(file);
  if (problem) return { ok: false, message: DOCUMENT_UPLOAD_REASONS[problem] ?? TRY_AGAIN };

  const worker = await me();
  if (!worker) return { ok: false, message: changeReason('unknown_staff') };
  if (!MAY_REQUEST.has(worker.status)) return { ok: false, message: changeReason('not_editable') };

  // evidenceFileProblem() has admitted only pdf / jpg / jpeg / png.
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const path = `${worker.staffId}/change-requests/${crypto.randomUUID()}.${ext}`;
  try {
    const { data, error } = await createAdminClient()
      .storage.from('documents')
      .createSignedUploadUrl(path);
    if (error || !data?.token) return { ok: false, message: TRY_AGAIN };
    return { ok: true, path, token: data.token };
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY missing (docs/12). Never fall back to the
    // worker's own session: it holds no Storage privilege on this bucket.
    return { ok: false, message: TRY_AGAIN };
  }
}

export type PhotoSlot = { ok: true; path: string } | { ok: false; message: string };

/**
 * Where a requested photo goes: a fresh `<staff_id>/selfie-<epoch>.jpg`.
 * Unlike `startPhotoUpload()` this is for a worker whose photo IS locked —
 * the upload is a proposal, and `staff.photo_path` does not move.
 */
export async function startChangePhotoUpload(): Promise<PhotoSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const worker = await me();
  if (!worker) return { ok: false, message: changeReason('unknown_staff') };
  if (!MAY_REQUEST.has(worker.status)) return { ok: false, message: changeReason('not_editable') };
  return { ok: true, path: photoPathFor(worker.staffId) };
}

async function request(args: Record<string, string | null>): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await (await db()).rpc('request_profile_change', args);
  if (error) return { ok: false, message: changeReason(error.message) };
  revalidatePath('/profile');
  revalidatePath('/profile/details');
  return { ok: true, note: 'Sent to the office. We’ll let you know when they’ve looked at it.' };
}

export async function requestNameChange(
  first: string,
  last: string,
  evidencePath: string | null,
  note: string,
): Promise<ActionResult> {
  return request({
    p_kind: 'name',
    p_first: first,
    p_last: last,
    p_photo_path: null,
    p_evidence_path: evidencePath,
    p_note: note.trim() || null,
  });
}

export async function requestPhotoChange(photoPath: string, note: string): Promise<ActionResult> {
  return request({
    p_kind: 'photo',
    p_first: null,
    p_last: null,
    p_photo_path: photoPath,
    p_evidence_path: null,
    p_note: note.trim() || null,
  });
}

/** Withdraw while pending. The RPC refuses another worker's id and a decided one. */
export async function withdrawChange(id: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await (await db()).rpc('withdraw_profile_change', { p_id: id });
  if (error) return { ok: false, message: changeReason(error.message) };
  revalidatePath('/profile');
  revalidatePath('/profile/details');
  return { ok: true, note: 'Request withdrawn.' };
}
