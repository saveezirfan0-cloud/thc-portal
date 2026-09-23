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
