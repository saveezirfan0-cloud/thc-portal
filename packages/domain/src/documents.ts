/**
 * The worker's Documents tab — §10.4, §4.1–4.5, §10.7.
 *
 * The pure rules the Staff App and the database have to agree on, each
 * mirroring a named SQL function in 20260923150000_staff_documents_hub.sql
 * (or earlier), in the style of `completionLetter.ts`:
 *
 *   - who may upload or declare from the app          ↔ submit_document_upload(),
 *                                                       declare_my_conviction()
 *   - where an upload goes in Storage                 ↔ evidence_upload_problem()
 *   - what a share code is                            ↔ submit_document_upload()
 *   - which state a document row is in (§4.4)         ↔ doc_expires_on() + the
 *                                                       ladder's 30-day window
 *   - what each refusal means to the worker
 *
 * Dates are ISO `YYYY-MM-DD`, UK calendar days (§1.8).
 */

import { isValidShareCode, normaliseShareCode } from './shareCode';
import type { StaffStatus } from './state';

/** Every value of the `doc_type` enum (0001_init). */
export const DOC_TYPES = [
  'passport',
  'birth_certificate',
  'ni_evidence',
  'national_id',
  'visa_document',
  'status_document',
  'university_term_dates_letter',
  'university_completion_letter',
  'share_code_report',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

/**
 * What the worker calls each document. The same strings as `doc_label()`
 * (20260921170411), which N1–N4 substitute into the push, so the push and
 * the row it deep-links to name the same thing.
 */
export const DOC_LABELS: Record<DocType, string> = {
  passport: 'Passport',
  birth_certificate: 'Birth certificate',
  ni_evidence: 'NI evidence',
  national_id: 'National ID',
  visa_document: 'Visa document',
  status_document: 'Status document',
  university_term_dates_letter: 'University Term Dates Letter',
  university_completion_letter: 'Official University Completion Letter',
  share_code_report: 'Right to work · share code',
};

// ---------------------------------------------------------------------
// Who may act from the app
// ---------------------------------------------------------------------

type BlockKind = 'auto_document' | 'manual' | 'conviction_review' | null;

/**
 * In employment, with something the worker can do: compliant, or blocked on
 * documents or a declaration. Never a manual hold (§10.1 case 2 — "nothing
 * for the worker to fix themselves"), never a candidate (the wizard, §10.3),
 * never a leaver or a removed account. Mirrors the eligibility check in both
 * `submit_document_upload()` and `declare_my_conviction()`.
 */
export function canActOnDocuments(status: StaffStatus, blockKind: BlockKind): boolean {
  if (status === 'compliant') return true;
  return status === 'blocked' && blockKind !== 'manual';
}

/**
 * §10.7: "Available to any compliant worker at any time" — and to a worker
 * already locked to Documents, whose declaration is added to the history.
 * A manual hold is refused because `block_worker()` would rewrite a manual
 * block as a conviction review, which the automatic re-check CAN lift.
 */
export const canDeclareConviction = canActOnDocuments;

// ---------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------

/** The Storage folder a document type's uploads go in: `passport`, `visa-document`, … */
export type DocumentFolder = string;

export function documentFolder(docType: DocType): DocumentFolder {
  return docType.replace(/_/g, '-');
}

/**
 * The types uploaded through `submit_document_upload()`. The completion
 * letter is not one of them — it has its own RPC because the requirement
 * makes the worker state the form and the course completion date (§2.1).
 */
export function usesGenericUpload(docType: DocType): boolean {
  return docType !== 'university_completion_letter';
}

/**
 * The nine characters to send, or null when it is not a share code. One
 * rule with the wizard: `isValidShareCode()` (shareCode.ts) is what the
 * database's is_valid_share_code() mirrors.
 */
export function parseShareCode(raw: string): string | null {
  return isValidShareCode(raw) ? normaliseShareCode(raw) : null;
}

/** What each refusal from `submit_document_upload()` means to the worker. */
export const DOCUMENT_UPLOAD_REASONS: Record<string, string> = {
  not_eligible: 'Your account cannot upload documents right now.',
  invalid_doc_type: 'Choose which document this is.',
  use_completion_letter: 'Upload the completion letter from its own row.',
  not_required: 'That document isn’t one we need from you.',
  already_pending: 'This document is already with the office for review.',
  file_required: 'Choose a file to upload.',
  share_code_invalid:
    'A share code is 9 letters and numbers, like W98 7ZY 6XK. You can get one at gov.uk/prove-right-to-work.',
  invalid_path: 'The upload did not complete. Please try again.',
  file_not_found: 'The upload did not complete. Please try again.',
  unsupported_file_type: 'Upload a PDF, JPG or PNG.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB.',
};

/** What each refusal from `sign_wtr_optout()` / `cancel_wtr_optout()` means. */
export const OPT_OUT_REASONS: Record<string, string> = {
  not_eligible: 'Your account cannot sign agreements right now.',
  age_unknown:
    'We don’t have your date of birth on file, so the opt-out can’t be offered. Please contact the office.',
  under_18: 'Workers under 18 cannot opt out of the 48-hour limit.',
  invalid_notice_period: 'The notice period must be between 7 days and 3 months.',
  already_signed: 'You have already signed the 48-hour opt-out.',
  no_active_optout: 'There is no signed opt-out to cancel.',
  invalid_path: 'The upload did not complete. Please try again.',
  file_not_found: 'The upload did not complete. Please try again.',
  unsupported_file_type: 'Upload a PDF, JPG or PNG.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB.',
};

/** What each refusal from `declare_my_conviction()` means. */
export const DECLARE_CONVICTION_REASONS: Record<string, string> = {
  not_eligible: 'Your account cannot make a declaration from the app. Please contact the office.',
  details_required: 'Enter the details of the conviction.',
  details_too_long: 'Keep the details under 4,000 characters — the office will contact you.',
  conviction_date_in_future: 'The date of conviction can’t be in the future.',
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
};

/** §10.7: the details field is bounded in the database at the same number. */
export const CONVICTION_DETAILS_MAX = 4000;

// ---------------------------------------------------------------------
// §4.4 · The state of one document row
// ---------------------------------------------------------------------

/** "expiring (≤30 days)" — the window N1 opens (§4.2, wireframes/staff/documents.html). */
export const EXPIRING_WITHIN_DAYS = 30;

export type DocumentState =
  | 'verified'
  | 'expiring'
  | 'expired'
  | 'in_review'
  | 'rejected'
  | 'superseded'
  /** A term letter that no longer applies: a verified completion letter stopped its ladder (§4.5). */
  | 'not_needed';

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Which of §4.4's states a row is in. `expiresOn` is `doc_expires_on()`'s
 * answer, not the printed date, so a term letter reads 31 December whatever
 * it says. A verified row expires ON its expiry day — that is the day N4
 * fires and the block lands (§4.3), matching `compliance_blockers()`'s
 * `expires_on <= today`.
 */
export function documentState(
  row: {
    docType: DocType;
    reviewStatus: 'pending' | 'verified' | 'rejected' | 'superseded';
    expiresOn: string | null;
  },
  today: string,
  termLetterApplies = true,
): DocumentState {
  if (row.reviewStatus === 'superseded') return 'superseded';
  if (row.reviewStatus === 'pending') return 'in_review';
  if (row.reviewStatus === 'rejected') return 'rejected';
  if (row.docType === 'university_term_dates_letter' && !termLetterApplies) return 'not_needed';
  if (row.expiresOn === null) return 'verified';
  const left = daysBetween(today, row.expiresOn);
  if (left <= 0) return 'expired';
  if (left <= EXPIRING_WITHIN_DAYS) return 'expiring';
  return 'verified';
}
