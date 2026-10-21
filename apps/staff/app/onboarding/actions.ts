'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isDocType,
  normaliseHomeOfficeRef,
  uploadError,
  uploadKind,
  UPLOAD_MAX_BYTES,
  UPLOAD_MIME,
} from '@thc/domain';
import type { DocType, HmrcGender, StudentLoanPlan } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import {
  PIN_MAX_FROM_POSTCODE_M,
  compactPostcode,
  geocodePostcode,
  metresBetween,
} from '../_lib/postcode';
import { addressLine, homeAddressMissing } from '../_lib/address';
import type { HomeAddressParts } from '../_lib/address';
import { photoPathFor } from '../profile/photos';
import { extractAfterResponse } from '../../lib/extract';
import { checkStoredMedia } from '../_lib/stored-media';
import { confirmCurrentPassword } from '../_lib/reauth';
import { NOT_CONFIGURED, reasonCode, reasonMessage } from './messages';
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

export type Result<T extends object = object> =
  ({ ok: true } & T) | { ok: false; message: string; reason?: string | null };

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
  { revalidate = true, client }: { revalidate?: boolean; client?: SupabaseClient } = {},
): Promise<Result<{ data: T }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = client ?? (await db());
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { ok: false, message: reasonMessage(error.message), reason: reasonCode(error.message) };
  }
  if (revalidate) refresh();
  return { ok: true, data: (data ?? {}) as T };
}

/** The caller's staff id, from the session — never from the request. */
async function sessionStaffId(client?: SupabaseClient): Promise<string | null> {
  const supabase = client ?? (await db());
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
  /** ADR-0182: sent on the Home Office check branch only. */
  homeOfficeRef?: string;
  visaType: string;
  ukChoice: string | null;
  wtrOptOut: boolean;
}): Promise<Result> {
  return call('onboarding_save_right_to_work', {
    p_branch: input.branch,
    p_dob: input.dob || null,
    p_share_code: input.shareCode || null,
    p_visa_type: input.visaType || null,
    // Still in the RPC's signature and ignored there: no branch types an
    // expiry any more — the gov.uk share-code check returns it (ADR-0078).
    p_visa_expiry: null,
    p_uk_doc_choice: input.ukChoice,
    p_wtr_optout: input.wtrOptOut,
    // The form's own normalising, so a reference pasted with a no-break
    // space is the one the database checks (normalise_home_office_ref()).
    p_home_office_ref: normaliseHomeOfficeRef(input.homeOfficeRef) || null,
  });
}

/**
 * After submitting step 4: a share code gov.uk did not recognise (or the
 * office rejected) is entered again, with the date of birth corrected if
 * that was the problem — `onboarding_reenter_share_code()` (ADR-0025). The
 * new code is checked with gov.uk at once.
 */
export async function reenterShareCode(input: { shareCode: string; dob: string }): Promise<Result> {
  return call('onboarding_reenter_share_code', {
    p_share_code: input.shareCode,
    p_dob: input.dob || null,
  });
}

// ---------------------------------------------------------------------
// 2/11 Home address
// ---------------------------------------------------------------------
/**
 * The pin is the worker's to place — the map is how they find their own
 * front door — but not anywhere they like: it is the §6 proximity factor,
 * so a point dropped beside the venues is a better score the worker chose
 * (security round 12.10, item 7).
 *
 * So, as /profile/details has done since 20260928110600: the candidate is
 * resolved from THEIR session (`staff_me()`), the postcode is geocoded
 * HERE (postcodes.io), and the save goes through the service key to
 * `onboarding_save_address_geocoded()` (20261012121400) with the server's
 * centroid. The RPC refuses a pin more than 5 km from it
 * (`pin_far_from_postcode`) — checked here first too, so the refusal costs
 * no round trip — and a session can no longer call the old
 * `onboarding_save_address()` at all.
 *
 * With no centroid there is nothing to hold the pin to, so a postcode
 * postcodes.io does not know, or postcodes.io being unreachable, is a
 * refusal the worker can act on rather than an unchecked save.
 */
export async function saveAddress(input: {
  address: HomeAddressParts;
  lat: number;
  lng: number;
}): Promise<Result> {
  // Every box but the flat is required (homeAddressMissing). The screen
  // keeps Continue disabled until then; this is the same rule on the
  // server, because the RPC only sees the joined line.
  const missing = homeAddressMissing(input.address);
  if (missing) return { ok: false, message: `${missing}.`, reason: 'address_required' };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, message: reasonMessage('pin_outside_uk'), reason: 'pin_outside_uk' };
  }

  const staffId = await sessionStaffId();
  if (!staffId)
    return { ok: false, message: reasonMessage('unknown_staff'), reason: 'unknown_staff' };

  const centre = await geocodePostcode(input.address.postcode);
  if (!centre.ok) {
    const reason =
      centre.reason === 'bad_postcode'
        ? 'bad_postcode'
        : centre.reason === 'unreachable'
          ? 'postcode_unreachable'
          : 'postcode_not_located';
    return { ok: false, message: reasonMessage(reason), reason };
  }
  if (metresBetween(centre, input) > PIN_MAX_FROM_POSTCODE_M) {
    return {
      ok: false,
      message: reasonMessage('pin_far_from_postcode'),
      reason: 'pin_far_from_postcode',
    };
  }

  const admin = await adminClient();
  // SUPABASE_SERVICE_ROLE_KEY missing (docs/12). Never the worker's own
  // session: it holds no grant on the geocoded RPC by design.
  if (!admin) return { ok: false, message: reasonMessage(null) };
  return call(
    'onboarding_save_address_geocoded',
    {
      p_staff: staffId,
      p_line: addressLine(input.address),
      p_town: input.address.town,
      p_postcode: input.address.postcode,
      p_lat: input.lat,
      p_lng: input.lng,
      p_postcode_lat: centre.lat,
      p_postcode_lng: centre.lng,
    },
    { client: admin },
  );
}

/**
 * Step 2 also asks which languages the worker speaks (ADR-0080):
 * `staff_save_languages()` writes their own row, English always in it.
 */
export async function saveLanguages(languages: string[]): Promise<Result> {
  // The address save that follows revalidates once for the step.
  return call('staff_save_languages', { p_languages: languages }, { revalidate: false });
}

/**
 * Postcode → a point to centre the map on, from postcodes.io through the
 * Staff App's one geocoder (app/_lib/postcode.ts, shared with
 * /profile/details). A convenience for finding the street; the pin the
 * worker then places is what is saved.
 */
export async function lookupPostcode(
  postcode: string,
): Promise<Result<{ lat: number; lng: number }>> {
  // Callable without signing in (/apply needs it), so it must not be an
  // open proxy to postcodes.io (security round 12.10, item 8): only a
  // string of a UK postcode's length and shape is ever sent anywhere —
  // geocodePostcode() then holds it to the strict outward+inward pattern.
  if (typeof postcode !== 'string' || postcode.length > 10 || !compactPostcode(postcode)) {
    return { ok: false, message: 'Enter a UK postcode, e.g. E2 0RY.' };
  }
  const found = await geocodePostcode(postcode);
  if (found.ok) return { ok: true, lat: found.lat, lng: found.lng };
  switch (found.reason) {
    case 'bad_postcode':
      return { ok: false, message: 'Enter a UK postcode, e.g. E2 0RY.' };
    case 'unreachable':
      return {
        ok: false,
        message: 'Postcode search is unreachable — use your location or move the map.',
      };
    default:
      return { ok: false, message: 'We couldn’t find that postcode.' };
  }
}

// ---------------------------------------------------------------------
// 3/11 Profile selfie
// ---------------------------------------------------------------------

/**
 * Where the selfie goes, built from the session and never taken from the
 * browser, and a signed upload URL for exactly that object.
 *
 * The URL is signed by the worker's OWN session, not the service key:
 * Storage checks `photos_worker_insert_own` before it signs, and records
 * the worker as the object's owner, just as the session's own upload did.
 * The browser then sends the JPEG in one PUT (app/_lib/signed-upload.ts)
 * and needs no Supabase client of its own (go-live audit L1).
 */
export async function startSelfieUpload(): Promise<Result<{ path: string; url: string }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const staffId = await sessionStaffId(supabase);
  if (!staffId) return { ok: false, message: reasonMessage('unknown_staff') };
  const path = photoPathFor(staffId);
  const { data: slot, error } = await supabase.storage.from('photos').createSignedUploadUrl(path);
  if (error || !slot?.signedUrl) {
    return { ok: false, message: 'That upload couldn’t start. Please try again.' };
  }
  return { ok: true, path, url: slot.signedUrl };
}

/**
 * The photo is uploaded under the worker's own session's signed URL
 * (photos_worker_insert_own, checked by Storage when it signed).
 * Its first bytes are read back through the same session
 * (photos_worker_read_own) and must be a JPEG, as its name says — the
 * Content-Type Storage recorded is only the browser's claim (security
 * round 12.10, item 5; app/_lib/stored-media.ts).
 */
export async function saveSelfie(path: string): Promise<Result> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const verdict = await checkStoredMedia(await db(), 'photos', path);
  if (verdict !== 'match') {
    const reason = verdict === 'mismatch' ? 'photo_not_image' : 'wrong_path';
    return { ok: false, message: reasonMessage(reason), reason };
  }
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
// straight to Storage in one PUT — a 10 MB scan never passes through a function with
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
}): Promise<Result<{ path: string; url: string; contentType: string }>> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  // The path is built from this field (§2.5 pt 7, paths.ts): a docType
  // that is not one of ours must never reach `documentPath`, or a signed
  // upload URL is minted for a key nothing will ever record or clean up.
  if (!isDocType(input.docType)) return { ok: false, message: reasonMessage('doc_not_for_branch') };
  const invalid = uploadError({ name: input.fileName, type: input.fileType, size: input.fileSize });
  if (invalid) return { ok: false, message: invalid };
  const kind = uploadKind({ name: input.fileName, type: input.fileType })!;

  const staffId = await sessionStaffId();
  if (!staffId) return { ok: false, message: reasonMessage('unknown_staff') };

  const admin = await adminClient();
  if (!admin) return { ok: false, message: STORAGE_NOT_CONFIGURED };

  const path = documentPath(staffId, input.docType, randomUUID(), kind);
  const { data: slot, error } = await admin.storage.from('documents').createSignedUploadUrl(path);
  if (error || !slot?.signedUrl)
    return { ok: false, message: 'That upload couldn’t start. Please try again.' };

  const contentType =
    Object.entries(UPLOAD_MIME).find(([, ext]) => ext === kind)?.[0] ?? 'application/octet-stream';
  // The browser PUTs the file to `url` with this type (app/_lib/signed-upload.ts),
  // so Storage records the type the server derived, not the picker's guess.
  return { ok: true, path: slot.path, url: slot.signedUrl, contentType };
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

  // The bytes must be what the name says (security round 12.10, item 5).
  // The extension is the server's (`documentPath`, from the kind it
  // accepted); `mime` is only what the browser told Storage.
  const verdict = await checkStoredMedia(admin, 'documents', input.path);
  if (verdict !== 'match') {
    if (verdict === 'mismatch') {
      await discard();
      return { ok: false, message: reasonMessage('file_type'), reason: 'file_type' };
    }
    return { ok: false, message: 'That upload didn’t finish. Please try again.' };
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

  // §2.6 — pre-fill, never verify (lib/extract.ts, shared with the
  // Documents tab so a renewal is read the same way). The read runs after
  // the response; the upload does not wait for it (ADR-0033).
  await extractAfterResponse(admin, recorded.data.docId, input.docType, input.path, mime);
  return { ok: true };
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
  gender?: HmrcGender | null;
}): Promise<Result> {
  // The 8-argument checklist (20260926100100): the gender HMRC's payroll
  // record needs, written with the checklist in one transaction. The
  // database refuses a missing one (`gender_required`).
  return call('submit_hmrc_checklist', {
    p_gender: input.gender ?? null,
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

/**
 * Step 9 goes through `staff_save_bank()`, which since 20261012120900 wants
 * a password sign-in in the last ten minutes (`reauth_required`). So the
 * step asks for the current password and signs in again with it, on the
 * same client, immediately before the save — as Profile → Payment does
 * (ADR-0113).
 */
export async function saveBank(input: {
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
  currentPassword: string;
}): Promise<Result> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = await db();
  const refused = await confirmCurrentPassword(supabase, input.currentPassword);
  if (refused) return { ok: false, message: refused };
  return call(
    'onboarding_save_bank',
    {
      p_account_holder: input.accountHolder,
      p_sort_code: input.sortCode,
      p_account_number: input.accountNumber,
    },
    { client: supabase },
  );
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
