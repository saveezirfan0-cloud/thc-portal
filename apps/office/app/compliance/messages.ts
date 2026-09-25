/**
 * What each refusal from the review RPCs means to the manager. The database
 * raises tokens (`not_pending: verified`, `already_expired: 2026-09-01`) so
 * that the rule and its wording live apart; this is the wording.
 */
const MESSAGES: [RegExp, string][] = [
  [/^not_authorised/, 'Only the office can review documents.'],
  [/^reason_required/, 'A rejection needs a reason — the worker is sent it.'],
  [/^not_pending: verified/, 'This has already been verified.'],
  [/^not_pending: rejected/, 'This has already been rejected. The worker re-uploads.'],
  [/^not_pending: superseded/, 'This belongs to a previous period and is read-only (§2.12).'],
  [/^not_pending/, 'This is no longer waiting for review.'],
  [
    /^not_reviewable/,
    'This person is Rejected or Removed; their documents no longer need review (§4.1).',
  ],
  [
    /^already_expired: (\d{4}-\d{2}-\d{2})/,
    'This document has already expired ($1) and cannot be accepted — reject it and ask for a current one (§4.2).',
  ],
  // compliance_verify_document on a term letter whose every holiday range
  // is past (20260928110300): "an already-expired letter is not accepted".
  [
    /^term_letter_expired/,
    'This letter has expired: every term date on it is before today. Reject it and ask the worker for a current letter (§4.2).',
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
  [
    /^rtw_date_required/,
    'Confirm the right-to-work date on this document before verifying it — the expiry of a visa or status document, or the date on the gov.uk report (§2.5, §2.6).',
  ],
  [
    /^no_time_limit_not_allowed/,
    'Only a share code showing EU settled status can be verified with no time limit (§2.5 pt 2).',
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
};

export function uploadRefusal(reason: string | undefined): string {
  return (reason && UPLOAD_REFUSALS[reason]) || 'The upload did not complete. Please try again.';
}

export function reviewErrorMessage(raw: string): string {
  for (const [pattern, message] of MESSAGES) {
    const match = pattern.exec(raw);
    if (match) return message.replace('$1', ukDate(match[1]));
  }
  return raw;
}

function ukDate(iso: string | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
