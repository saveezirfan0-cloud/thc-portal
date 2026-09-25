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
  // is past (20260927181100): "an already-expired letter is not accepted".
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
    /^not_a_share_code/,
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
  [/^(document|declaration)_not_found/, 'This item no longer exists — refresh the queue.'],
];

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
