/**
 * Verify / Reject on a profile's Documents tab (audit item 8), decided
 * without a browser: which window a Verify opens, and the review window's
 * item built from the profile's document row. The windows and the RPCs are
 * Compliance → Needs review's own (ReviewModals.tsx, actions.ts), so a
 * document is decided the same way on either screen.
 */
import type { RtwCheckRow } from '../_lib/rtwCheck';
import { conditionFieldFor } from './conditions';
import type { ReviewItem } from './ReviewModals';
import { rtwDateRule } from './rtw';
import type { ReviewFacts } from './actions';

/** The document columns this needs, as staff_documents_v returns them. */
export interface ProfileDocument {
  id: string;
  doc_type: string;
  doc_label: string;
  review_status: 'pending' | 'verified' | 'rejected' | 'superseded';
  superseded: boolean;
  uploaded_at: string;
  expiry_date: string | null;
  right_to_work_until: string | null;
  share_code: string | null;
  gov_report_path?: string | null;
  completion_date_claimed?: string | null;
  evidence_form?: string | null;
  ni_recheck?: boolean | null;
}

/** The profile columns this needs. */
export interface ProfileSubject {
  id: string;
  display_name: string;
  status: string;
  rtw_branch: string | null;
  right_to_work_until: string | null;
}

const CANDIDATE = ['interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'];

/** Pending, current, on a profile the office still reviews. */
export function reviewableOnProfile(doc: ProfileDocument, subject: ProfileSubject): boolean {
  return (
    doc.review_status === 'pending' &&
    !doc.superseded &&
    subject.status !== 'rejected' &&
    subject.status !== 'removed'
  );
}

/**
 * What pressing Verify does:
 *   approve   — a completion letter: confirm the completion date and visa expiry
 *   rtw_date  — a visa / status document or share code: confirm its date
 *   confirm   — NI evidence (the number beside it) or a student's term letter
 *               (the course level)
 *   direct    — nothing to confirm
 *   automated — a share code the automated gov.uk check verifies: no Verify here
 */
export type ProfileVerifyStep = 'approve' | 'rtw_date' | 'confirm' | 'direct' | 'automated';

export function profileVerifyStep(
  doc: Pick<ProfileDocument, 'doc_type'>,
  branch: string | null,
  manualAllowed: boolean,
): ProfileVerifyStep {
  if (doc.doc_type === 'university_completion_letter') return 'approve';
  if (doc.doc_type === 'share_code_report' && !manualAllowed) return 'automated';
  if (rtwDateRule(doc.doc_type, branch)) return 'rtw_date';
  if (doc.doc_type === 'ni_evidence' || conditionFieldFor(doc.doc_type, branch) !== null) {
    return 'confirm';
  }
  return 'direct';
}

/** The review window's item for a profile document. */
export function profileReviewItem(
  doc: ProfileDocument,
  subject: ProfileSubject,
  facts: ReviewFacts | null = null,
  check: RtwCheckRow | null = null,
): ReviewItem {
  return {
    kind: 'document',
    item_id: doc.id,
    staff_id: subject.id,
    display_name: subject.display_name,
    is_candidate: CANDIDATE.includes(subject.status),
    item_type: doc.doc_type,
    item_label: doc.doc_label,
    submitted_at: doc.uploaded_at,
    rtw_branch: subject.rtw_branch,
    expiry_date: doc.expiry_date,
    doc_right_to_work_until: doc.right_to_work_until,
    share_code: doc.share_code,
    staff_right_to_work_until: subject.right_to_work_until,
    completion_date_claimed: doc.completion_date_claimed ?? null,
    evidence_form: (doc.evidence_form as ReviewItem['evidence_form']) ?? null,
    declaration_source: null,
    rtw_check_reason: check?.review_reason ?? null,
    rtw_check_conditions: check?.conditions ?? null,
    rtw_check_term_limit: check?.term_time_limit_hours ?? null,
    ni_number: doc.doc_type === 'ni_evidence' ? (facts?.niNumber ?? null) : null,
    below_degree_level: facts?.belowDegreeLevel ?? null,
    visa_weekly_hour_limit: facts?.visaHourLimit ?? null,
  };
}

/** The office's completion-letter upload is offered to a live Student-visa profile with none pending (D47). */
export function canUploadCompletionLetter(
  subject: Pick<ProfileSubject, 'status' | 'rtw_branch'> & { removed?: boolean },
  documents: readonly Pick<ProfileDocument, 'doc_type' | 'review_status'>[],
): boolean {
  if (subject.rtw_branch !== 'international_student') return false;
  if (subject.removed || ['rejected', 'removed', 'inactive'].includes(subject.status)) return false;
  return !documents.some(
    (d) => d.doc_type === 'university_completion_letter' && d.review_status === 'pending',
  );
}

/**
 * "Attach gov.uk report" on a share code with no report on file (D31): the
 * manual path — the automated check stores its own, so a document whose
 * check holds a report is left alone.
 */
export function canAttachReport(
  doc: Pick<ProfileDocument, 'doc_type' | 'review_status' | 'gov_report_path'>,
  check: Pick<RtwCheckRow, 'report_path'> | null,
): boolean {
  return (
    doc.doc_type === 'share_code_report' &&
    doc.review_status !== 'superseded' &&
    !doc.gov_report_path &&
    !check?.report_path
  );
}
