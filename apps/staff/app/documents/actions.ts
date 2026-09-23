'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@thc/db/admin';
import {
  COMPLETION_EVIDENCE_FORMS,
  COMPLETION_UPLOAD_REASONS,
  DECLARE_CONVICTION_REASONS,
  DOCUMENT_UPLOAD_REASONS,
  OPT_OUT_NOTICE_MAX_DAYS,
  OPT_OUT_NOTICE_MIN_DAYS,
  OPT_OUT_REASONS,
  canActOnDocuments,
  documentFolder,
  evidenceFileProblem,
  evidenceObjectPath,
  isDocType,
  usesGenericUpload,
} from '@thc/domain';
import type { CompletionEvidenceForm, EvidenceFolder, StaffStatus } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import type { ActionResult } from './types';

/**
 * Every write the Documents tab makes — §10.4, §10.7 and the completion
 * letter requirement (§2.1, §2.4).
 *
 * The rules live in the database (20260923100100, 20260923150000); this
 * file is the glue and the sentence the worker sees for each refusal.
 *
 * Uploads: the service key issues, the worker's session decides
 * --------------------------------------------------------------
 * The `documents` bucket is service-role only (20260922183015, asserted by
 * 320_storage.sql) and stays that way. So an upload is two steps:
 *
 *   1. `startUpload()` authorises the worker FROM THEIR SESSION
 *      (`staff_me()`), checks the file's name/type/size with
 *      `evidenceFileProblem()`, builds the object name with
 *      `evidenceObjectPath()` — `<staff_id>/<folder>/<uuid>.<ext>`, a fresh
 *      id, never the worker's file name — and has the SERVICE KEY issue a
 *      one-object signed upload for exactly that name.
 *   2. The browser sends the file straight to Storage with that token, and
 *      then a `finish…()` action calls the RPC AS THE WORKER'S SESSION.
 *      The RPC judges what Storage actually recorded — real content type
 *      and size, under the caller's own folder — not what the browser said
 *      in step 1 (`evidence_upload_problem()`).
 *
 * Why the file does not pass through this server action: §2.1 allows 10 MB,
 * a Next.js server action takes 1 MB by default and a Vercel function
 * 4.5 MB at most. The signed upload is still issued with the service key for
 * one named object, so no worker holds a Storage privilege of their own.
 *
 * A refused upload leaves an object nobody points at; `discard()` removes
 * it with the service key, and only ever under the worker's own prefix.
 */

const BUCKET = 'documents';

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';
const TRY_AGAIN = 'The upload did not complete. Please try again.';

async function db() {
  return staffDb(await cookies());
}

interface Me {
  staffId: string;
  status: StaffStatus;
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null;
}

async function me(): Promise<Me | null> {
  const { data } = await (await db()).rpc('staff_me');
  const row = data as Record<string, unknown> | null;
  if (!row?.['staffId']) return null;
  return {
    staffId: String(row['staffId']),
    status: row['status'] as StaffStatus,
    blockKind: (row['blockKind'] as Me['blockKind']) ?? null,
  };
}

function refresh() {
  revalidatePath('/documents');
  revalidatePath('/', 'layout');
}

function reasonText(table: Record<string, string>, raw: string | undefined): string {
  if (!raw) return TRY_AGAIN;
  for (const [code, sentence] of Object.entries(table)) {
    if (raw === code || raw.includes(code)) return sentence;
  }
  return raw;
}

// ---------------------------------------------------------------------
// Step 1 · a one-object signed upload
// ---------------------------------------------------------------------

export type UploadPurpose =
  { kind: 'document'; docType: string } | { kind: 'completion-letter' } | { kind: 'wtr-optout' };

export type UploadSlot = { ok: true; path: string; token: string } | { ok: false; message: string };

export async function startUpload(
  purpose: UploadPurpose,
  file: { name: string; type: string; size: number },
): Promise<UploadSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const problem = evidenceFileProblem(file);
  if (problem) return { ok: false, message: DOCUMENT_UPLOAD_REASONS[problem] ?? TRY_AGAIN };

  const worker = await me();
  if (!worker) return { ok: false, message: DECLARE_CONVICTION_REASONS['unknown_staff']! };

  let folder: string;
  if (purpose.kind === 'document') {
    if (!isDocType(purpose.docType) || !usesGenericUpload(purpose.docType)) {
      return { ok: false, message: DOCUMENT_UPLOAD_REASONS['invalid_doc_type']! };
    }
    if (!canActOnDocuments(worker.status, worker.blockKind)) {
      return { ok: false, message: DOCUMENT_UPLOAD_REASONS['not_eligible']! };
    }
    folder = documentFolder(purpose.docType);
  } else {
    if (
      purpose.kind === 'completion-letter' &&
      !canActOnDocuments(worker.status, worker.blockKind)
    ) {
      return { ok: false, message: COMPLETION_UPLOAD_REASONS['not_eligible']! };
    }
    folder = purpose.kind satisfies EvidenceFolder;
  }

  let path: string;
  try {
    path = evidenceObjectPath(worker.staffId, folder, crypto.randomUUID(), file.name);
  } catch {
    return { ok: false, message: DOCUMENT_UPLOAD_REASONS['unsupported_file_type']! };
  }

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data?.token) return { ok: false, message: TRY_AGAIN };
    return { ok: true, path, token: data.token };
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY missing from this deployment: the one
    // server-side secret the upload needs (docs/12). Say "try again"
    // rather than 500 — and never fall back to the worker's own session,
    // which holds no Storage privilege on this bucket by design.
    return { ok: false, message: TRY_AGAIN };
  }
}

/**
 * A refused upload is removed — but only one the database confirms is the
 * caller's own, uploaded within the hour, and referenced by nothing
 * (`evidence_path_discardable()`). The path comes from the browser, so
 * without that a worker could name their own verified passport, have the
 * RPC refuse it, and have the service key delete right-to-work evidence.
 */
async function discard(path: string | null) {
  if (!path) return;
  const worker = await me();
  if (!worker || !path.startsWith(`${worker.staffId}/`)) return;
  try {
    const admin = createAdminClient();
    const { data: discardable } = await admin.rpc(
      'evidence_path_discardable' as never,
      {
        p_staff: worker.staffId,
        p_path: path,
      } as never,
    );
    if (discardable !== true) return;
    await admin.storage.from(BUCKET).remove([path]);
  } catch {
    // Best effort: an orphan in a private bucket is untidy, not a leak.
  }
}

type RpcAnswer = { ok?: boolean; reason?: string; documentId?: string } & Record<string, unknown>;

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await (await db()).rpc(fn, args);
  return { answer: (data ?? null) as RpcAnswer | null, error };
}

// ---------------------------------------------------------------------
// Step 2 · the worker's RPCs
// ---------------------------------------------------------------------

/**
 * Upload / Re-upload for every document but the completion letter
 * (`submit_document_upload()`). Lands pending; nothing else changes until
 * the office verifies it (§4.3).
 */
export async function finishDocumentUpload(
  docType: string,
  path: string | null,
  shareCode: string | null,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const { answer, error } = await rpc('submit_document_upload', {
    p_doc_type: docType,
    p_file_path: path,
    p_share_code: shareCode,
  });
  if (error || !answer?.ok) {
    await discard(path);
    return {
      ok: false,
      message: reasonText(DOCUMENT_UPLOAD_REASONS, answer?.reason ?? error?.message),
    };
  }
  refresh();
  return {
    ok: true,
    note: 'Sent to the office for review. Nothing changes on your account until they verify it.',
  };
}

/**
 * The completion letter (`submit_completion_letter()`, requirement §2.1).
 * Pending, and it changes NO cap until approved (acceptance criterion 2).
 */
export async function finishCompletionLetter(input: {
  path: string;
  completionDate: string;
  form: string;
  institution: string;
}): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(COMPLETION_EVIDENCE_FORMS as readonly string[]).includes(input.form)) {
    await discard(input.path);
    return { ok: false, message: COMPLETION_UPLOAD_REASONS['invalid_form']! };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.completionDate)) {
    await discard(input.path);
    return { ok: false, message: COMPLETION_UPLOAD_REASONS['completion_date_required']! };
  }
  const { answer, error } = await rpc('submit_completion_letter', {
    p_file_path: input.path,
    p_completion_date: input.completionDate,
    p_evidence_form: input.form as CompletionEvidenceForm,
    p_awarding_institution: input.institution.trim() || null,
  });
  if (error || !answer?.ok) {
    await discard(input.path);
    return {
      ok: false,
      message: reasonText(COMPLETION_UPLOAD_REASONS, answer?.reason ?? error?.message),
    };
  }
  refresh();
  return {
    ok: true,
    note: 'Received. Your weekly limit does not change until the office approves the letter — you’ll get a notification either way.',
  };
}

/** Sign the 48-hour opt-out (`sign_wtr_optout()`, requirement §2.4). */
export async function signOptOut(
  noticeDays: number,
  signedCopyPath: string | null,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (
    !Number.isInteger(noticeDays) ||
    noticeDays < OPT_OUT_NOTICE_MIN_DAYS ||
    noticeDays > OPT_OUT_NOTICE_MAX_DAYS
  ) {
    await discard(signedCopyPath);
    return { ok: false, message: OPT_OUT_REASONS['invalid_notice_period']! };
  }
  const { answer, error } = await rpc('sign_wtr_optout', {
    p_signed_copy_path: signedCopyPath,
    p_notice_days: noticeDays,
  });
  if (error || !answer?.ok) {
    await discard(signedCopyPath);
    return { ok: false, message: reasonText(OPT_OUT_REASONS, answer?.reason ?? error?.message) };
  }
  refresh();
  return { ok: true, note: 'Signed. The office has been told.' };
}

/** Give notice to cancel it (`cancel_wtr_optout()`, acceptance criterion 5). */
export async function cancelOptOut(): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const { answer, error } = await rpc('cancel_wtr_optout', {});
  if (error || !answer?.ok) {
    return { ok: false, message: reasonText(OPT_OUT_REASONS, answer?.reason ?? error?.message) };
  }
  refresh();
  const from = typeof answer['effectiveFrom'] === 'string' ? answer['effectiveFrom'] : null;
  return {
    ok: true,
    note: from
      ? `Notice given. The 48-hour limit applies again from ${from.split('-').reverse().join('.')}.`
      : 'Notice given.',
  };
}

/**
 * §10.7 — `declare_my_conviction()`, which takes no staff id (docs/14 O10).
 * On success the worker is blocked, their future bookings released and
 * their invitations withdrawn, and E9 goes to the office without the text;
 * every cached screen has to go, not just this one.
 */
export async function declareConviction(
  details: string,
  convictionDate: string | null,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const text = details.trim();
  if (!text) return { ok: false, message: DECLARE_CONVICTION_REASONS['details_required']! };
  const date = convictionDate && /^\d{4}-\d{2}-\d{2}$/.test(convictionDate) ? convictionDate : null;
  const { answer, error } = await rpc('declare_my_conviction', {
    p_details: text,
    p_conviction_date: date,
  });
  if (error || !answer?.ok) {
    return {
      ok: false,
      message: reasonText(DECLARE_CONVICTION_REASONS, answer?.reason ?? error?.message),
    };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
