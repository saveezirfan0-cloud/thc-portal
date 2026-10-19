'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@thc/db/admin';
import { DOCUMENT_UPLOAD_REASONS, evidenceFileProblem } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../../../db';
import { photoPathFor } from '../../photos';
import { changeReason } from '../../change-requests';
import { checkStoredMedia } from '../../../_lib/stored-media';
import type { ActionResult } from '../../types';

/**
 * Request a change — the worker's actions (ADR-0045, 20260930202200).
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
/** A read that failed is not "we couldn't find your record" (audit D18) — main's words. */
const COULD_NOT_READ = 'We couldn’t reach your profile just now. Please try again.';

async function db() {
  return staffDb(await cookies());
}

/**
 * The caller, from their own session — `staff_me()`, no id to forge — or
 * why not. A failed read is `COULD_NOT_READ`, kept apart from "no record"
 * (audit D18), the way `startPhotoUpload()` keeps them apart.
 */
async function me(): Promise<
  | { ok: true; staffId: string; status: string; blockKind: string | null }
  | { ok: false; message: string }
> {
  const { data, error } = await (await db()).rpc('staff_me', {});
  if (error) return { ok: false, message: COULD_NOT_READ };
  const row = data as Record<string, unknown> | null;
  if (!row?.['staffId']) return { ok: false, message: changeReason('unknown_staff') };
  return {
    ok: true,
    staffId: row['staffId'] as string,
    status: row['status'] as string,
    blockKind: (row['blockKind'] as string | null) ?? null,
  };
}

/**
 * Whether `request_profile_change()` would accept this worker — asked here
 * only to fail before an upload. Compliant, or blocked on documents or a
 * conviction review; never a manual hold (20260930206000).
 */
function mayRequest(worker: { status: string; blockKind: string | null }): boolean {
  if (worker.status === 'compliant') return true;
  return worker.status === 'blocked' && worker.blockKind !== 'manual';
}

export type UploadSlot = { ok: true; path: string; url: string } | { ok: false; message: string };

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
  if (!worker.ok) return { ok: false, message: worker.message };
  if (!mayRequest(worker)) return { ok: false, message: changeReason('not_editable') };

  // evidenceFileProblem() has admitted only pdf / jpg / jpeg / png.
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const path = `${worker.staffId}/change-requests/${crypto.randomUUID()}.${ext}`;
  try {
    const { data, error } = await createAdminClient()
      .storage.from('documents')
      .createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return { ok: false, message: TRY_AGAIN };
    return { ok: true, path, url: data.signedUrl };
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY missing (docs/12). Never fall back to the
    // worker's own session: it holds no Storage privilege on this bucket.
    return { ok: false, message: TRY_AGAIN };
  }
}

export type PhotoSlot = { ok: true; path: string; url: string } | { ok: false; message: string };

/**
 * Where a requested photo goes: a fresh `<staff_id>/selfie-<epoch>.jpg`.
 * Unlike `startPhotoUpload()` this is for a worker whose photo IS locked —
 * the upload is a proposal, and `staff.photo_path` does not move.
 */
export async function startChangePhotoUpload(): Promise<PhotoSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const worker = await me();
  if (!worker.ok) return { ok: false, message: worker.message };
  if (!mayRequest(worker)) return { ok: false, message: changeReason('not_editable') };
  // Signed by the worker's own session: Storage checks
  // photos_worker_insert_own before it signs, as the upload itself did.
  const path = photoPathFor(worker.staffId);
  const { data, error } = await (await db()).storage.from('photos').createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return { ok: false, message: TRY_AGAIN };
  return { ok: true, path, url: data.signedUrl };
}

/**
 * The uploaded object's first bytes must be what its name says (security
 * round 12.10, item 5; app/_lib/stored-media.ts) — the Content-Type
 * Storage recorded is only the browser's claim. Evidence lives in
 * `documents`, which only the service key reads, and is read only under
 * the caller's own prefix; a photo is read through the worker's own
 * session (`photos_worker_read_own`). A path outside the caller's folder
 * is left to the RPC, which refuses it as it always has.
 */
async function storedFileProblem(
  bucket: 'documents' | 'photos',
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  let verdict;
  if (bucket === 'photos') {
    verdict = await checkStoredMedia(await db(), bucket, path);
  } else {
    const worker = await me();
    if (!worker.ok) return worker.message;
    if (!path.startsWith(`${worker.staffId}/change-requests/`)) return null;
    try {
      verdict = await checkStoredMedia(createAdminClient(), bucket, path);
    } catch {
      return TRY_AGAIN;
    }
  }
  if (verdict === 'match') return null;
  return verdict === 'mismatch'
    ? (DOCUMENT_UPLOAD_REASONS['unsupported_file_type'] ?? TRY_AGAIN)
    : TRY_AGAIN;
}

async function request(args: Record<string, string | null>): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const forged =
    (await storedFileProblem('documents', args['p_evidence_path'] ?? null)) ??
    (await storedFileProblem('photos', args['p_photo_path'] ?? null));
  if (forged) return { ok: false, message: forged };
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

/**
 * A date of birth (ADR-0070) — its own RPC, `request_dob_change()`, with
 * request_profile_change()'s gates and the date rule (`dob_change_problem`);
 * the evidence goes through the same signed upload as a name's.
 */
export async function requestDobChange(
  dob: string,
  evidencePath: string | null,
  note: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const forged = await storedFileProblem('documents', evidencePath);
  if (forged) return { ok: false, message: forged };
  const { error } = await (
    await db()
  ).rpc('request_dob_change', {
    p_dob: dob,
    p_evidence_path: evidencePath,
    p_note: note.trim() || null,
  });
  if (error) return { ok: false, message: changeReason(error.message) };
  revalidatePath('/profile');
  revalidatePath('/profile/details');
  return { ok: true, note: 'Sent to the office. We’ll let you know when they’ve looked at it.' };
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
