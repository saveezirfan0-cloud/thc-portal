'use client';

import { DOCUMENT_UPLOAD_REASONS, evidenceFileProblem } from '@thc/domain';
import { putSignedUpload } from '../../_lib/signed-upload';
import { startUpload } from '../actions';
import type { UploadPurpose } from '../actions';

/**
 * Step 1 and the transfer of an evidence upload (see `../actions.ts`).
 *
 * The file is checked here first — `evidenceFileProblem()` is the fast
 * answer before anything leaves the phone — then the server issues a
 * one-object signed upload for a name IT chose, and the browser sends the
 * bytes straight to Storage in one PUT (`putSignedUpload`; no Supabase
 * client on this screen). The content type sent is the file's own, which
 * is what Storage records and what the RPC then checks.
 */
export type Uploaded = { ok: true; path: string } | { ok: false; message: string };

export async function uploadEvidence(purpose: UploadPurpose, file: File): Promise<Uploaded> {
  const meta = { name: file.name, type: file.type, size: file.size };
  const problem = evidenceFileProblem(meta);
  if (problem)
    return { ok: false, message: DOCUMENT_UPLOAD_REASONS[problem] ?? 'Please try again.' };

  const slot = await startUpload(purpose, meta);
  if (!slot.ok) return slot;

  const sent = await putSignedUpload(slot.url, file, file.type);
  if (!sent) return { ok: false, message: 'The upload did not complete. Please try again.' };
  return { ok: true, path: slot.path };
}

/** What the file input accepts — §2.1 "PDF, JPG, PNG". */
export const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
