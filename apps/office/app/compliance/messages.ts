import { explainDbError } from '../_lib/dbError';

/**
 * What each refusal from the review RPCs means to the manager. The database
 * raises tokens (`not_pending: verified`, `already_expired: 2026-09-01`) so
 * that the rule and its wording live apart; this is the wording.
 */
const MESSAGES: [RegExp, string][] = [
  [/^not_authorised/, 'Only the office can review documents.'],
  // ADR-0180: only named office users decide a criminal declaration.
  [
    /^not_criminal_records_reviewer/,
    'Only office users allowed to review criminal records can decide this.',
  ],
  [/^reason_required/, 'A rejection needs a reason — the worker is sent it.'],
  [/^not_pending: verified/, 'This has already been verified.'],
  [/^not_pending: rejected/, 'This has already been rejected. The worker re-uploads.'],
  [/^not_pending: superseded/, 'This belongs to a previous period and is read-only.'],
  [/^not_pending/, 'This is no longer waiting for review.'],
  // ADR-0213: "Not needed — graduated" on a term letter.
  [
    /^no_graduation/,
    'They have not told us of a course completion date that has passed, so this letter is still needed. Verify or reject it as usual.',
  ],
  [/^not_a_term_letter/, 'Only a University Term Dates Letter can be set aside as not needed.'],
  [/^not_reviewable/, 'This person is Rejected or Removed; their documents no longer need review.'],
  [
    /^already_expired: (\d{4}-\d{2}-\d{2})/,
    'This document has already expired ($1) and cannot be accepted — reject it and ask for a current one.',
  ],
  // set_passport_expiry (20261025100000, ADR-0201).
  [
    /^passport_expiry_implausible: (\d{4}-\d{2}-\d{2})/,
    'A passport does not run that long ($1). Check the year on the document.',
  ],
  [/^not_a_passport/, 'Only a passport’s expiry can be set here.'],
  // compliance_verify_document on a term letter whose every holiday range
  // is past (20260928110300): "an already-expired letter is not accepted".
  [
    /^term_letter_expired/,
    'This letter has expired: every term date on it is before today. Reject it and ask the worker for a current letter.',
  ],
  [
    /^use_approve_completion_letter/,
    'A completion letter is approved with its completion date and visa expiry.',
  ],
  [
    /^completion_letter_needs_approval/,
    'A completion letter needs the completion date and visa expiry confirmed before it is approved.',
  ],
  [/^completion_date_required/, 'Confirm the course completion date.'],
  [/^visa_expiry_required/, 'Confirm the visa expiry date.'],
  [/^term_dates_invalid/, 'A holiday range needs both a start and an end date.'],
  // ADR-0183: a period over a year is a typed year (20261022155000/155300);
  // Postgres refuses a backwards or unreadable daterange before any body runs.
  [
    /^term_dates_implausible/,
    'A holiday period cannot run for more than a year — check the year of each date.',
  ],
  [
    /range lower bound must be less than or equal to range upper bound/,
    'A holiday period ends before it starts — check its dates.',
  ],
  [/malformed range literal/, 'A holiday period could not be read — enter both of its dates.'],
  [/date\/time field value out of range/, 'That date is not a real calendar date.'],
  // Withdrawing a completion letter's approval (ADR-0183).
  [/^not_a_completion_letter/, 'Only a completion letter’s approval can be withdrawn.'],
  [/^letter_not_verified/, 'This letter is not verified, so there is no approval to withdraw.'],
  [/^note_too_long/, 'Keep the reason to 500 characters.'],
  [
    /^illegal_review_transition/,
    'A verified completion letter can only be withdrawn, not put back under review or rejected.',
  ],
  // set_term_letter_periods (ADR-0178): correcting a verified letter's periods.
  [
    /^term_letter_not_verified/,
    'This letter is still waiting for review — confirm its periods with Verify.',
  ],
  [/^not_a_term_letter/, 'Only a University Term Dates Letter has holiday periods.'],
  [
    /^term_periods_expire_letter/,
    'Those periods would leave the letter expired: its last date must be after today. Check the dates, or ask the worker for a current letter.',
  ],
  [
    /^rtw_date_required/,
    'Confirm the right-to-work date on this document before verifying it — the expiry of a visa or status document, or the date on the gov.uk report.',
  ],
  [
    /^no_time_limit_not_allowed/,
    'Only a share code showing EU settled status can be verified with no time limit.',
  ],
  [/^date_invalid/, 'That date is not a real calendar date.'],
  // compliance_confirm_rtw_date (20260927160000)
  [
    /^not_a_share_code(?!_document)/,
    'Only a share code report is re-verified for its date. A visa or status document is re-uploaded and verified with its expiry.',
  ],
  [
    /^not_verified/,
    'This report has not been verified yet — verify it, with its date, from the queue.',
  ],
  [
    /^superseded_by_newer/,
    'A newer share code report has been verified for this worker; the date on file comes from that one.',
  ],
  // The automated gov.uk check (ADR-0025).
  [
    /^rtw_check_required/,
    'The automatic gov.uk check verifies this share code. Run the check again; a date is typed by hand only once a check is in Needs review.',
  ],
  [/^rtw_check_running/, 'The gov.uk check is already running for this share code.'],
  [
    /^rtw_check_disabled/,
    'The automatic gov.uk check is switched off (settings.rtw_check.enabled) — verify the share code by hand.',
  ],
  [/^no_share_code/, 'There is no share code on this document to check.'],
  [/^not_needs_review/, 'This check is not waiting for the office.'],
  [/^rtw_check_not_found/, 'This check no longer exists — refresh the page.'],
  [/^(document|declaration)_not_found/, 'This item no longer exists — refresh the queue.'],
  // The conditions the reviewer sets (20260930130100) and the NI check (20260930130400).
  [/^not_student_visa/, 'The course level applies to the International student route only.'],
  [
    /^no_visa_hour_limit_on_branch/,
    'Only a work visa or a dependant visa can carry an hours limit of its own.',
  ],
  [/^visa_hour_limit_invalid/, 'A visa hours limit is between 1 and 48 hours a week.'],
  [/^value_required/, 'Choose yes or no.'],
  [/^no_ni_check_due/, 'This NI evidence is not waiting to be compared — refresh the queue.'],
  [/^ni_number_not_entered/, 'No NI number has been entered yet, so there is nothing to compare.'],
  [/^not_a_share_code_document/, 'Only a share code document carries a gov.uk report.'],
  [/^unknown_staff/, 'This person no longer exists — refresh the page.'],
  // The Home Office check result (ADR-0182).
  [/^home_office_result_missing/, 'Attach the Home Office check result before verifying it.'],
  [/^approved_on_required/, 'Enter the date approved, as it is printed on the Home Office result.'],
  [/^approved_on_invalid/, 'The date approved cannot be in the future.'],
  [/^approved_on_implausible/, 'Check the date approved — it is before 2000.'],
  [
    /^until_too_far/,
    'The right to work can run at most a year from the date approved — check the date.',
  ],
  [
    /^until_before_approved/,
    'The right-to-work date must be after the date the Home Office approved the result.',
  ],
  [/^not_a_home_office_check/, 'Only a Home Office check result is verified this way.'],
];

/** The office upload RPCs answer `{ ok: false, reason }`; these are the words. */
const UPLOAD_REFUSALS: Record<string, string> = {
  not_eligible: 'Evidence cannot be added to a rejected, removed or inactive profile.',
  not_student_visa: 'The completion letter is only for the International student route.',
  invalid_form: 'Choose what kind of document this is.',
  completion_date_required: 'Enter the course completion date shown on the document.',
  completion_date_implausible: 'Check the course completion date — it does not look right.',
  invalid_path: 'The upload did not complete. Please try again.',
  file_not_found: 'The upload did not complete. Please try again.',
  unsupported_file_type: 'Upload a PDF, JPG or PNG.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB.',
  already_pending:
    'A completion letter is already waiting in Needs review — decide that one first.',
  report_already_attached: 'A gov.uk report is already attached to this share code.',
  automated_check_owns_report:
    'The automatic gov.uk check stores its own report for this share code. Attach one by hand only once its check is in Needs review.',
  not_home_office_branch:
    'A Home Office check result is only for someone on the Home Office check route. Change their right-to-work route first.',
};

export function uploadRefusal(reason: string | undefined): string {
  return (reason && UPLOAD_REFUSALS[reason]) || 'The upload did not complete. Please try again.';
}

export function reviewErrorMessage(raw: string): string {
  for (const [pattern, message] of MESSAGES) {
    const match = pattern.exec(raw);
    if (match) return message.replace('$1', ukDate(match[1]));
  }
  // Release audit D-M5: anything else is never shown raw — our own raised
  // sentences are kept, Postgres's templates become a sentence (_lib/dbError).
  return explainDbError(raw, { log: '[compliance]' });
}

function ukDate(iso: string | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Documents whose AI read pre-fills an expiry the office can retry. */
const RESCANNABLE = new Set(['passport', 'national_id', 'visa_document', 'status_document']);

export function canRescan(docType: string): boolean {
  return RESCANNABLE.has(docType);
}

/** ADR-0212 (TK-18): a photo (JPG or PNG) the office may turn the right way up. */
export function canRotate(mimeType: string | null): boolean {
  return mimeType === 'image/jpeg' || mimeType === 'image/png';
}

/** What the Staff App's reader reports back (apps/staff/lib/extract.ts). */
export interface ScanSummary {
  confidence: number;
  expiryFound: boolean;
  reasons: string[];
}

const SCAN_REASONS: Record<string, string> = {
  not_this_document_type: 'it does not look like the right kind of document',
  not_legible: 'the page is blurred, cut off or hard to read',
  no_expiry_date: 'no expiry date could be read',
  bad_expiry_date: 'the expiry date it read was not a valid date',
  timeout: 'the AI took too long to answer',
  connection_error: 'the AI could not be reached',
  unparseable_answer: 'the AI gave an answer that could not be used',
  'unsupported_input:image_too_large': 'the photo is over 5 MB',
};

/** One sentence for the reviewer: what the retry found, and if not, why. */
export function scanOutcomeMessage(summary: ScanSummary): string {
  const pct = Math.round(summary.confidence * 100);
  if (summary.expiryFound && summary.reasons.length === 0) {
    return `AI scan done (${pct}%): expiry read. Check it against the document before you verify.`;
  }
  const why = summary.reasons
    .map(
      (r) =>
        SCAN_REASONS[r] ??
        (r.startsWith('unsupported_input')
          ? 'the file type cannot be read by the AI'
          : r.startsWith('api_error')
            ? 'the AI service returned an error'
            : null),
    )
    .filter((r): r is string => r !== null);
  const reason = why.length ? why.join('; ') : 'the read was not confident enough';
  return `AI scan done (${pct}%), but ${reason}. Enter the date by hand on Verify.`;
}
