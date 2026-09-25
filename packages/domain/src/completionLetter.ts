/**
 * University Completion Letter and the 48-hour opt-out — the pure rules
 * around RULE-20 (docs/scope/university-completion-letter-requirement.pdf).
 *
 * The cap itself is `weeklyCap()` in cap.ts and is not re-derived here. What
 * lives here is what the Staff App (S4) and the Back Office need to agree on
 * with the database, each mirroring a named SQL function:
 *
 *   - what an acceptable upload is (§2.1)          ↔ evidence_upload_problem()
 *   - where it goes in Storage                      ↔ the same function's path check
 *   - when an approval starts to count (§2.3)       ↔ completion_effective_from()
 *   - when a cancelled opt-out stops counting (§2.4) ↔ cancel_wtr_optout()
 *   - who may sign an opt-out (§2.4)                ↔ sign_wtr_optout()
 *   - which right-to-work alert rung is due (§2.3)  ↔ rtw_daily()
 *
 * Dates are ISO `YYYY-MM-DD`, UK calendar days (§1.8).
 */

import { capWeekStart } from './cap';
import type { DocumentFolder } from './documents';

// ---------------------------------------------------------------------
// §2.1 Upload
// ---------------------------------------------------------------------

/** One document type, three acceptable forms (§2.1). */
export const COMPLETION_EVIDENCE_FORMS = ['letter', 'transcript', 'university_email'] as const;
export type CompletionEvidenceForm = (typeof COMPLETION_EVIDENCE_FORMS)[number];

export const COMPLETION_EVIDENCE_FORM_LABELS: Record<CompletionEvidenceForm, string> = {
  letter: 'Official university completion letter',
  transcript: 'Final / completers transcript showing the award or completion date',
  university_email: 'Official university email confirming course completion',
};

/** §2.1 "Sensible max file size (e.g. 10MB)". The database enforces the same number. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/** §2.1 "Accepted formats: PDF, JPG, PNG" — by extension, with the one content type each. */
export const EVIDENCE_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
} as const;
export type EvidenceExtension = keyof typeof EVIDENCE_TYPES;

/** The two folders a worker's own evidence lives in, under their staff id. */
export type EvidenceFolder = 'completion-letter' | 'wtr-optout';

export type EvidenceProblem =
  'unsupported_file_type' | 'file_empty' | 'file_too_large' | 'invalid_path';

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return match ? match[1]!.toLowerCase() : '';
}

/**
 * Why a file the worker picked cannot be uploaded, or null. Checked in the
 * browser for a fast answer and again by `evidence_upload_problem()` against
 * what Storage actually recorded — this one is a courtesy, that one is the
 * rule.
 */
export function evidenceFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): EvidenceProblem | null {
  const ext = extensionOf(file.name);
  if (!(ext in EVIDENCE_TYPES)) return 'unsupported_file_type';
  if (EVIDENCE_TYPES[ext as EvidenceExtension] !== file.type.toLowerCase()) {
    return 'unsupported_file_type';
  }
  if (file.size <= 0) return 'file_empty';
  if (file.size > EVIDENCE_MAX_BYTES) return 'file_too_large';
  return null;
}

/**
 * The object name in the private `documents` bucket (bucket-relative, which is
 * what `compliance_docs.file_path` stores and what §1.7's `storage_deletions`
 * deletes):
 *
 *     <staffId>/completion-letter/<fileId>.<pdf|jpg|jpeg|png>
 *     <staffId>/wtr-optout/<fileId>.<pdf|jpg|jpeg|png>
 *
 * `fileId` should be a fresh random id (e.g. `crypto.randomUUID()`), never
 * the worker's own file name: names leak, collide, and carry characters the
 * database's path check refuses.
 */
export function evidenceObjectPath(
  staffId: string,
  /**
   * A completion-letter / opt-out folder, or a document type's own folder
   * (`documentFolder()` in documents.ts: `<staffId>/passport/<fileId>.pdf`),
   * which is where `submit_document_upload()` looks.
   */
  folder: EvidenceFolder | DocumentFolder,
  fileId: string,
  fileName: string,
): string {
  const ext = extensionOf(fileName);
  if (!(ext in EVIDENCE_TYPES)) throw new Error('unsupported_file_type');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileId)) throw new Error('invalid_path');
  return `${staffId}/${folder}/${fileId}.${ext}`;
}

/** What each refusal from `submit_completion_letter()` means to the worker. */
export const COMPLETION_UPLOAD_REASONS: Record<string, string> = {
  not_eligible: 'Your account cannot upload documents right now.',
  not_student_visa: 'The completion letter is only for workers on a Student visa.',
  invalid_form: 'Choose what kind of document this is.',
  completion_date_required: 'Enter the course completion date shown on the document.',
  completion_date_implausible: 'Check the course completion date — it does not look right.',
  invalid_path: 'The upload did not complete. Please try again.',
  file_not_found: 'The upload did not complete. Please try again.',
  unsupported_file_type: 'Upload a PDF, JPG or PNG.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB.',
  already_pending: 'Your completion letter is already with the office for review.',
};

// ---------------------------------------------------------------------
// §2.3 Effect of approval
// ---------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The first day an approved letter lifts the cap: the first Monday on or after
 * the LATER of the course completion date and the verification day — or that
 * day itself when it is a Monday. `weeklyCap()` releases a week only when it
 * STARTS on or after both (a straddling week keeps the lower cap), so the
 * release always begins on a Monday and never splits a Mon–Sun week, whether
 * the completion date is in the future or long past. Mirrors
 * `completion_effective_from()`.
 */
export function completionEffectiveFrom(completionDate: string, verifiedOn: string): string {
  const later = completionDate > verifiedOn ? completionDate : verifiedOn;
  const monday = capWeekStart(later);
  return monday === later ? later : addDays(monday, 7);
}

/**
 * §7: "Worker's visa expires before or shortly after completion → expiry logic
 * takes precedence over the 48-hour release." True when the release would
 * start after the last day the worker may work, so it never starts.
 */
export function releaseBlockedByVisa(effectiveFrom: string, visaExpiry: string | null): boolean {
  return visaExpiry !== null && visaExpiry < effectiveFrom;
}

// ---------------------------------------------------------------------
// §2.4 The 48-hour opt-out
// ---------------------------------------------------------------------

/** "7 days' notice (an agreement may specify up to 3 months' notice)". */
export const OPT_OUT_NOTICE_MIN_DAYS = 7;
export const OPT_OUT_NOTICE_MAX_DAYS = 92;

/**
 * "Workers under 18 cannot opt out — do not offer the opt-out flow". An
 * unknown date of birth is not offered either: the office cannot show it
 * checked an age it does not have. Mirrors `sign_wtr_optout()`.
 */
export function canSignOptOut(dob: string | null, today: string): boolean {
  if (!dob) return false;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const eighteenth = `${String(y + 18).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return eighteenth <= today;
}

/**
 * The day the 48-hour ceiling comes back after notice is given: the END of
 * the notice period, which is what `weeklyCap()` reads as
 * `optOutCancelledFrom` (acceptance criterion 5).
 */
export function optOutCancelledFrom(noticeGivenOn: string, noticeDays: number): string {
  if (noticeDays < OPT_OUT_NOTICE_MIN_DAYS || noticeDays > OPT_OUT_NOTICE_MAX_DAYS) {
    throw new Error('invalid_notice_period');
  }
  return addDays(noticeGivenOn, noticeDays);
}

// ---------------------------------------------------------------------
// §2.3 Right-to-work alerts to the office
// ---------------------------------------------------------------------

export type RtwAlertTier = 60 | 30 | 14;

/**
 * Which rung of the 60/30/14-day alert is due, as a band (so a missed day does
 * not skip one), or null when none is. Mirrors `rtw_daily()`.
 */
export function rtwAlertTier(daysLeft: number): RtwAlertTier | null {
  if (daysLeft < 0 || daysLeft > 60) return null;
  if (daysLeft > 30) return 60;
  if (daysLeft > 14) return 30;
  return 14;
}
