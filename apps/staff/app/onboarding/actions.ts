'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadError, uploadKind, UPLOAD_MAX_BYTES, UPLOAD_MIME } from '@thc/domain';
import type { DocType, StudentLoanPlan } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import { photoPathFor } from '../profile/photos';
import { documentExtractor, toDaterangeLiteral } from './extractor';
import { NOT_CONFIGURED, reasonMessage } from './messages';
import { documentPath, isOwnDocumentPath } from './paths';
import type { Referee } from './state';

/**
 * Every write the wizard makes — one RPC per step (20260923120000/100/200).
 *
 * The rules live in those functions: the stage, the order, the document
 * set, the share-code format, the 80% pass mark, the NI lock, the version
 * signed. This file adds the sentence the worker reads when one refuses,
 * and the two things only a server can do — hold the service key for the
 * private `documents` bucket, and run the extractor.
 */

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

async function db(): Promise<SupabaseClient> {
  return staffDb(await cookies());
}

function refresh() {
  revalidatePath('/onboarding', 'layout');
}

/**
 * `revalidate: false` for the two writes whose answer the screen must keep
 * showing — the quiz result and the signature stamp. Revalidating would
 * re-render the step in the same response, and the step that was just
 * completed is no longer the open one, so the result would be replaced by
 * the next step before the worker had read it. The next navigation loads
 * fresh anyway: every onboarding page is dynamic.
 */
async function call<T extends object = object>(
  fn: string,
  args: Record<string, unknown> = {},
  { revalidate = true }: { revalidate?: boolean } = {},
): Promise<Result<{ data: T }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: reasonMessage(error.message) };
  if (revalidate) refresh();
  return { ok: true, data: (data ?? {}) as T };
}

/** The caller's staff id, from the session — never from the request. */
async function sessionStaffId(): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase.rpc('staff_me');
  const staffId = (data as Record<string, unknown> | null)?.['staffId'];
  return typeof staffId === 'string' ? staffId : null;
}

// ---------------------------------------------------------------------
// 1/11 Right to work
// ---------------------------------------------------------------------
export async function saveRightToWork(input: {
  branch: string;
  dob: string;
  shareCode: string;
  visaType: string;
  visaExpiry: string;
  ukChoice: string | null;
  wtrOptOut: boolean;
}): Promise<Result> {
  return call('onboarding_save_right_to_work', {
    p_branch: input.branch,
    p_dob: input.dob || null,
    p_share_code: input.shareCode || null,
    p_visa_type: input.visaType || null,
    p_visa_expiry: input.visaExpiry || null,
    p_uk_doc_choice: input.ukChoice,
    p_wtr_optout: input.wtrOptOut,
  });
}

// ---------------------------------------------------------------------
// 2/11 Home address
// ---------------------------------------------------------------------
export async function saveAddress(input: {
  line: string;
  town: string;
  postcode: string;
  lat: number;
  lng: number;
}): Promise<Result> {
  return call('onboarding_save_address', {
    p_line: input.line,
    p_town: input.town,
    p_postcode: input.postcode,
    p_lat: input.lat,
    p_lng: input.lng,
  });
}

/**
 * Postcode → a point to centre the map on, from postcodes.io (open data,
 * no key, UK-only — which is exactly the population). A convenience for
 * finding the street; the pin the worker then places is what is saved.
 */
export async function lookupPostcode(
  postcode: string,
): Promise<Result<{ lat: number; lng: number }>> {
  const code = postcode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(code)) {
    return { ok: false, message: 'Enter a UK postcode, e.g. E2 0RY.' };
  }
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${code}`, {
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, message: 'We couldn’t find that postcode.' };
    const body = (await response.json()) as { result?: { latitude?: number; longitude?: number } };
    const lat = body.result?.latitude;
    const lng = body.result?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { ok: false, message: 'We couldn’t find that postcode.' };
    }
    return { ok: true, lat, lng };
  } catch {
    return {
      ok: false,
      message: 'Postcode search is unreachable — use your location or move the map.',
    };
  }
}

// ---------------------------------------------------------------------
// 3/11 Profile selfie
// ---------------------------------------------------------------------

/** Where the selfie goes — built from the session, never taken from the browser. */
export async function startSelfieUpload(): Promise<Result<{ path: string }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const staffId = await sessionStaffId();
  if (!staffId) return { ok: false, message: reasonMessage('unknown_staff') };
  return { ok: true, path: photoPathFor(staffId) };
}

/** The photo is uploaded by the worker's own session (photos_worker_insert_own). */
export async function saveSelfie(path: string): Promise<Result> {
  const set = await call('staff_set_photo', { p_path: path });
  if (!set.ok) return set;
  return call('onboarding_confirm_selfie');
}

/** A returning worker (§2.12) already has a locked photo: confirm it. */
export async function confirmSelfie(): Promise<Result> {
  return call('onboarding_confirm_selfie');
}

// ---------------------------------------------------------------------
// 4/11 Documents
//
// The `documents` bucket has no worker policy (20260922183015), so the
// file goes up through a signed upload URL minted here with the service
// key, for a path built here from the session. The browser uploads
// straight to Storage — a 10 MB scan never passes through a function with
// a body limit — and then `finishDocumentUpload` records it AS THE WORKER,
// with the size and type Storage measured rather than the ones the
// browser claimed. `onboarding_attach_document()` checks the rest.
// ---------------------------------------------------------------------
async function adminClient(): Promise<SupabaseClient | null> {
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) return null;
  const { createAdminClient } = await import('@thc/db/admin');
  return createAdminClient() as unknown as SupabaseClient;
}

const STORAGE_NOT_CONFIGURED =
  'Document upload is not configured in this environment (SUPABASE_SERVICE_ROLE_KEY). See docs/04-setup-github-vercel-supabase.md.';

export async function startDocumentUpload(input: {
  docType: DocType;
  fileName: string;
  fileSize: number;
  fileType: string;
}): Promise<Result<{ path: string; token: string; contentType: string }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const invalid = uploadError({ name: input.fileName, type: input.fileType, size: input.fileSize });
  if (invalid) return { ok: false, message: invalid };
  const kind = uploadKind({ name: input.fileName, type: input.fileType })!;

  const staffId = await sessionStaffId();
  if (!staffId) return { ok: false, message: reasonMessage('unknown_staff') };

  const admin = await adminClient();
  if (!admin) return { ok: false, message: STORAGE_NOT_CONFIGURED };

  const path = documentPath(staffId, input.docType, randomUUID(), kind);
  const { data: slot, error } = await admin.storage.from('documents').createSignedUploadUrl(path);
  if (error || !slot)
    return { ok: false, message: 'That upload couldn’t start. Please try again.' };

  const contentType =
    Object.entries(UPLOAD_MIME).find(([, ext]) => ext === kind)?.[0] ?? 'application/octet-stream';
  return { ok: true, path: slot.path, token: slot.token, contentType };
}

export async function finishDocumentUpload(input: {
  docType: DocType;
  path: string;
  fileName: string;
}): Promise<Result> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  // The path came back from the browser. Before the service key touches
  // it — list, download, or delete — it must be one this session could
  // have been handed by startDocumentUpload.
  const staffId = await sessionStaffId();
  if (!staffId || !isOwnDocumentPath(staffId, input.docType, input.path)) {
    return { ok: false, message: reasonMessage('wrong_path') };
  }
  const admin = await adminClient();
  if (!admin) return { ok: false, message: STORAGE_NOT_CONFIGURED };

  const slash = input.path.lastIndexOf('/');
  const folder = input.path.slice(0, slash);
  const name = input.path.slice(slash + 1);
  const { data: listed } = await admin.storage.from('documents').list(folder, { search: name });
  const object = listed?.find((o) => o.name === name);
  const size = Number(object?.metadata?.['size'] ?? 0);
  const mime = String(object?.metadata?.['mimetype'] ?? '');
  if (!object) return { ok: false, message: 'That upload didn’t finish. Please try again.' };

  // Only a fresh, unreferenced object is removed (evidence_path_discardable):
  // the path is the browser's, and a verified document's path would
  // otherwise be deletable by having this attach refuse it.
  const discard = async () => {
    const { data: discardable } = await admin.rpc(
      'evidence_path_discardable' as never,
      {
        p_staff: staffId,
        p_path: input.path,
      } as never,
    );
    if (discardable !== true) return;
    await admin.storage.from('documents').remove([input.path]);
  };
  if (size > UPLOAD_MAX_BYTES || size <= 0) {
    await discard();
    return { ok: false, message: reasonMessage(size <= 0 ? 'file_empty' : 'file_too_large') };
  }

  const recorded = await call<{ docId: string }>('onboarding_attach_document', {
    p_doc_type: input.docType,
    p_path: input.path,
    p_file_name: input.fileName,
    p_file_size: size,
    p_mime: mime,
  });
  if (!recorded.ok) {
    await discard();
    return recorded;
  }

  await extract(admin, recorded.data.docId, input.docType, input.path, mime);
  return { ok: true };
}

/**
 * §2.6 — pre-fill, never verify. A failed or absent extractor leaves the
 * document flagged for manual review, which is where it started; it never
 * fails the upload.
 */
async function extract(
  admin: SupabaseClient,
  docId: string,
  docType: DocType,
  path: string,
  mimeType: string,
) {
  const extractor = documentExtractor();
  if (!extractor) return;
  try {
    const { data: file } = await admin.storage.from('documents').download(path);
    if (!file) return;
    const result = await extractor.extract({
      docType,
      path,
      mimeType,
      bytes: await file.arrayBuffer(),
    });
    await admin.rpc('record_document_extraction', {
      p_doc: docId,
      p_expiry: result.expiryDate,
      p_term_dates: result.holidays?.map(toDaterangeLiteral) ?? null,
      p_completion: result.completionDate,
      p_institution: result.awardingInstitution,
      p_confidence: result.confidence,
      p_raw: { provider: extractor.provider, ...result.raw },
    });
  } catch (error) {
    console.error('document extraction failed', docId, error);
  }
}

export async function submitDocuments(input: {
  hasConviction: boolean | null;
  details: string;
  convictionDate: string;
}): Promise<Result<{ advanced: boolean }>> {
  const result = await call<{ advanced?: boolean }>('onboarding_submit_documents', {
    p_has_conviction: input.hasConviction,
    p_details: input.details || null,
    p_conviction_date: input.convictionDate || null,
  });
  if (!result.ok) return result;
  return { ok: true, advanced: Boolean(result.data.advanced) };
}

// ---------------------------------------------------------------------
// 5/11 Induction · 6/11 Quiz
// ---------------------------------------------------------------------
export async function completeInduction(): Promise<Result> {
  return call('onboarding_complete_induction');
}

export interface QuizResult {
  attemptNo: number;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  outcome: 'passed' | 'retry' | 'rejected';
  attemptsLeft: number;
}

export async function submitQuiz(
  answers: Record<string, number>,
): Promise<Result<{ result: QuizResult }>> {
  const result = await call<QuizResult>(
    'submit_quiz_attempt',
    { p_answers: answers },
    { revalidate: false },
  );
  if (!result.ok) return result;
  return { ok: true, result: result.data };
}

// ---------------------------------------------------------------------
// 7/11 HMRC · 8/11 References · 9/11 Bank
// ---------------------------------------------------------------------
export async function submitHmrc(input: {
  q1OtherJob: boolean | null;
  q2Pension: boolean | null;
  q3Since6April: boolean | null;
  studentLoan: StudentLoanPlan | null;
  postgraduateLoan: boolean;
  niNumber: string;
  declared: boolean;
}): Promise<Result> {
  return call('submit_hmrc_checklist', {
    p_q1_other_job: input.q1OtherJob,
    p_q2_pension: input.q2Pension,
    p_q3_since_april: input.q3Since6April,
    p_student_loan: input.studentLoan,
    p_postgraduate: input.postgraduateLoan,
    p_ni_number: input.niNumber.trim() || null,
    p_declared: input.declared,
  });
}

export async function saveReferences(referees: Referee[]): Promise<Result> {
  return call('onboarding_save_references', { p_referees: referees });
}

export async function saveBank(input: {
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
}): Promise<Result> {
  return call('onboarding_save_bank', {
    p_account_holder: input.accountHolder,
    p_sort_code: input.sortCode,
    p_account_number: input.accountNumber,
  });
}

// ---------------------------------------------------------------------
// 10/11 Contract · 11/11 How it works
// ---------------------------------------------------------------------
export async function signContract(
  version: string,
): Promise<Result<{ stamp: string; employeeId: number | null }>> {
  const result = await call<{ stamp?: string; employeeId?: number }>(
    'sign_contract',
    { p_version: version, p_agree: true },
    { revalidate: false },
  );
  if (!result.ok) return result;
  return { ok: true, stamp: result.data.stamp ?? '', employeeId: result.data.employeeId ?? null };
}

export async function finishTutorial(): Promise<Result> {
  return call('onboarding_finish_tutorial');
}
